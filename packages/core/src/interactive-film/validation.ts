import type { StoryGraph, StoryNode } from "./graph-schema.js";

export interface ValidationIssue {
  readonly code: "DEAD_END" | "BROKEN_LINK" | "UNREACHABLE" | "NO_PATH_TO_ENDING" | "VARIABLE_UNWRITTEN" | "VARIABLE_UNREAD" | "ENDING_VARIETY" | "IMAGE_MISSING";
  readonly level: "error" | "warning" | "info";
  readonly message: string;
  readonly nodeIds: readonly string[];
}

export interface ValidationReport {
  readonly ok: boolean;
  readonly issues: readonly ValidationIssue[];
}

function label(node: StoryNode): string {
  return node.title || node.id;
}

export function validateStoryGraph(graph: StoryGraph): ValidationReport {
  const issues: ValidationIssue[] = [];
  const ids = new Set(graph.nodes.map((n) => n.id));
  const nodeMap = new Map(graph.nodes.map((n) => [n.id, n]));

  // BROKEN_LINK
  for (const node of graph.nodes) {
    for (const c of node.choices) {
      if (!ids.has(c.targetNodeId)) {
        issues.push({
          code: "BROKEN_LINK",
          level: "error",
          message: `节点「${label(node)}」的选项「${c.text}」指向不存在的节点 ${c.targetNodeId}`,
          nodeIds: [node.id],
        });
      }
    }
  }

  // DEAD_END：非结局节点没有任何指向存在节点的出口
  for (const node of graph.nodes) {
    if (node.type === "ending") continue;
    const hasExit = node.choices.some((c) => ids.has(c.targetNodeId));
    if (!hasExit) {
      issues.push({
        code: "DEAD_END",
        level: "error",
        message: `节点「${label(node)}」是死路：没有任何有效出口`,
        nodeIds: [node.id],
      });
    }
  }

  // 可达性 BFS
  const start = graph.nodes.find((n) => n.type === "start") ?? graph.nodes[0];
  const reachable = new Set<string>();
  if (start) {
    const queue = [start.id];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      if (reachable.has(cur)) continue;
      reachable.add(cur);
      const n = nodeMap.get(cur);
      if (!n) continue;
      for (const c of n.choices) {
        if (ids.has(c.targetNodeId) && !reachable.has(c.targetNodeId)) queue.push(c.targetNodeId);
      }
    }
  }

  // UNREACHABLE
  for (const node of graph.nodes) {
    if (graph.nodes.length > 1 && !reachable.has(node.id)) {
      issues.push({
        code: "UNREACHABLE",
        level: "warning",
        message: `节点「${label(node)}」从开场无法到达`,
        nodeIds: [node.id],
      });
    }
  }

  // NO_PATH_TO_ENDING
  if (start) {
    let canEnd = false;
    for (const id of reachable) {
      if (nodeMap.get(id)?.type === "ending") { canEnd = true; break; }
    }
    if (!canEnd) {
      issues.push({
        code: "NO_PATH_TO_ENDING",
        level: "error",
        message: `从开场节点「${label(start)}」出发无法到达任何结局`,
        nodeIds: [start.id],
      });
    }
  }

  return { ok: issues.every((i) => i.level !== "error"), issues };
}

export function reviewStoryGraph(graph: StoryGraph): ValidationReport {
  const issues: ValidationIssue[] = [...validateStoryGraph(graph).issues];

  const reads = new Set<string>();
  const writes = new Set<string>();
  for (const node of graph.nodes) {
    for (const choice of node.choices) {
      if (choice.condition) reads.add(choice.condition.var);
      for (const effect of choice.effects) writes.add(effect.var);
    }
  }
  const definedOrWritten = new Set<string>([...graph.variables.map((v) => v.name), ...writes]);

  for (const v of reads) {
    if (!writes.has(v)) {
      issues.push({
        code: "VARIABLE_UNWRITTEN",
        level: "warning",
        message: `变量「${v}」被选项条件读取，但没有任何选项写入它——该条件门除默认值外永远不会改变`,
        nodeIds: [],
      });
    }
  }
  for (const v of definedOrWritten) {
    if (!reads.has(v)) {
      issues.push({
        code: "VARIABLE_UNREAD",
        level: "info",
        message: `变量「${v}」定义或写入了，但没有任何条件读取它——对分支没有影响`,
        nodeIds: [],
      });
    }
  }

  if (graph.endings.length >= 2) {
    const types = new Set(graph.endings.map((e) => e.type));
    if (types.size === 1) {
      issues.push({
        code: "ENDING_VARIETY",
        level: "info",
        message: `${graph.endings.length} 个结局都是同一类型（${[...types][0]}），重玩价值低——考虑设计不同基调的结局`,
        nodeIds: graph.endings.map((e) => e.nodeId),
      });
    }
  }

  for (const node of graph.nodes) {
    if (node.type !== "ending" && !node.imageSlot?.assetRef) {
      issues.push({
        code: "IMAGE_MISSING",
        level: "info",
        message: `节点「${node.title || node.id}」还没有配图`,
        nodeIds: [node.id],
      });
    }
  }

  return { ok: issues.every((i) => i.level !== "error"), issues };
}
