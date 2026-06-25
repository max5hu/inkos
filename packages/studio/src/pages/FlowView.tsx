import { useState, useEffect } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  Handle,
  Position,
  useNodesState,
  useEdgesState,
  type NodeProps,
  type Node,
  type Edge,
  type ReactFlowProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useApi, fetchJson } from "../hooks/use-api";
import { useColors } from "../hooks/use-colors";
import type { Theme } from "../hooks/use-theme";
import type { TFunction } from "../hooks/use-i18n";
import { layoutStoryGraph } from "../lib/story-flow-layout";
import { moveNodeDelta, addNodeDelta, genNodeId, addChoiceDelta, removeChoicesDelta, removeNodeDelta, genChoiceId } from "../lib/story-editor-deltas";
import type { StoryGraph } from "@actalk/inkos-core/interactive-film/graph-schema";

interface Nav {
  toDashboard: () => void;
  toFilm: (id: string) => void;
}

// v12: define Node type with data shape, then use NodeProps<StoryNode>
type StoryNode = Node<{ label: string; nodeType: string }, "story">;
type StoryEdge = Edge;

const TYPE_COLOR: Record<string, string> = {
  start: "bg-emerald-500/15 border-emerald-500/50",
  branch: "bg-amber-500/15 border-amber-500/50",
  ending: "bg-rose-500/15 border-rose-500/50",
  merge: "bg-sky-500/15 border-sky-500/50",
  explore: "bg-violet-500/15 border-violet-500/50",
  normal: "bg-muted border-border",
};

function StoryFlowNode({ id, data }: NodeProps<StoryNode>) {
  const cls = TYPE_COLOR[data.nodeType] ?? TYPE_COLOR.normal;
  return (
    <div
      data-testid={`flow-node-${id}`}
      className={`px-3 py-2 rounded border text-xs text-foreground ${cls}`}
    >
      <Handle type="target" position={Position.Left} />
      <div className="font-medium">{data.label}</div>
      <div className="opacity-60 text-xs">{data.nodeType}</div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

// Module-level constant so nodeTypes reference is stable across renders
const nodeTypes = { story: StoryFlowNode };

export default function FlowView({
  projectId,
  nav,
  theme,
  t,
}: {
  projectId: string;
  nav: Nav;
  theme: Theme;
  t: TFunction;
}) {
  const c = useColors(theme);
  const { data: graph, loading, error, refetch } = useApi<StoryGraph>(
    `/projects/${projectId}/story-graph`,
  );

  const [rfNodes, setRfNodes, onNodesChange] = useNodesState<StoryNode>([]);
  const [rfEdges, setRfEdges, onEdgesChange] = useEdgesState<StoryEdge>([]);
  const [editing, setEditing] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  // Re-seed controlled state whenever graph data changes (e.g. after refetch)
  useEffect(() => {
    if (!graph) return;
    const layout = layoutStoryGraph(graph);
    setRfNodes(layout.nodes as StoryNode[]);
    setRfEdges(layout.edges);
  }, [graph, setRfNodes, setRfEdges]);

  const post = async (body: { delta: unknown }) => {
    setEditError(null);
    try {
      await fetchJson(`/projects/${projectId}/story-graph/delta`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      await refetch();
    } catch (e) {
      setEditError(e instanceof Error ? e.message : String(e));
    }
  };

  const onNodeDragStop: NonNullable<ReactFlowProps<StoryNode, StoryEdge>["onNodeDragStop"]> = async (_evt, node) => {
    if (!editing || !graph) return;
    const orig = graph.nodes.find((g) => g.id === node.id);
    if (!orig) return;
    await post(moveNodeDelta(orig, Math.round(node.position.x), Math.round(node.position.y)));
  };

  const onConnect = async (c: { source: string | null; target: string | null }) => {
    if (!editing || !graph || !c.source || !c.target) return;
    if (c.source === c.target) return;
    const src = graph.nodes.find((g) => g.id === c.source);
    if (!src) return;
    await post(addChoiceDelta(src, { id: genChoiceId(), text: "新选项", targetNodeId: c.target }));
  };

  const onNodesDelete = async (deleted: Array<{ id: string }>) => {
    if (!editing) return;
    for (const d of deleted) await post(removeNodeDelta(d.id));
  };

  const onEdgesDelete = async (deleted: Array<{ id: string }>) => {
    if (!editing || !graph) return;
    const bySource = new Map<string, string[]>();
    for (const e of deleted) {
      const [source, choiceId] = e.id.split("->"); // layout edge id format: ${node.id}->${choice.id}
      if (source && choiceId) {
        const list = bySource.get(source) ?? [];
        list.push(choiceId);
        bySource.set(source, list);
      }
    }
    for (const [source, choiceIds] of bySource) {
      const src = graph.nodes.find((g) => g.id === source);
      if (src) await post(removeChoicesDelta(src, choiceIds));
    }
  };

  const onAddNode = async () => {
    await post(
      addNodeDelta({
        id: genNodeId(),
        type: "normal",
        title: "新节点",
        choices: [],
        position: { x: 80, y: 80 },
      } as never),
    );
  };

  if (loading) return <div className={c.muted}>{t("common.loading")}</div>;
  if (error)
    return (
      <div className="text-red-400">
        {t("common.error")}: {error}
      </div>
    );
  if (!graph) return null;

  return (
    <div className="space-y-3" data-testid="flow-view">
      <div className="flex items-center gap-3 text-sm">
        <button
          onClick={() => nav.toFilm(projectId)}
          className={c.link}
          data-testid="flow-back"
        >
          ← {t("bread.film")}
        </button>
        <span data-testid="flow-title">{graph.title || projectId}</span>
        <button
          data-testid="flow-edit-toggle"
          onClick={() => setEditing((v) => !v)}
          className={`ml-auto px-3 py-1 rounded text-xs ${c.btnSecondary}`}
        >
          {editing ? "完成编辑" : "编辑"}
        </button>
        {editing && (
          <button
            data-testid="flow-add-node"
            onClick={onAddNode}
            className={`px-3 py-1 rounded text-xs ${c.btnSecondary}`}
          >
            加节点
          </button>
        )}
      </div>
      {editError && (
        <div data-testid="flow-edit-error" className="text-red-400 text-xs">
          {editError}
        </div>
      )}
      <div style={{ height: "70vh" }} className="border rounded">
        <ReactFlow
          nodes={rfNodes}
          edges={rfEdges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          nodeTypes={nodeTypes}
          fitView
          colorMode={theme === "dark" ? "dark" : "light"}
          nodesDraggable={editing}
          nodesConnectable={editing}
          elementsSelectable={editing}
          onNodeDragStop={onNodeDragStop}
          onConnect={onConnect}
          onNodesDelete={onNodesDelete}
          onEdgesDelete={onEdgesDelete}
          deleteKeyCode={editing ? ["Delete", "Backspace"] : null}
        >
          <Background />
          <Controls />
        </ReactFlow>
      </div>
    </div>
  );
}
