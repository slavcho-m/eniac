import { useMemo } from "react";
import { SectionLabel } from "@/components";
import { cn } from "@/lib/cn";
import styles from "./RepoGraph.module.css";

interface RepoGraphProps {
  /** The project id, shown as the root node's label. */
  rootLabel: string;
  /** Discovered child repos, relative paths (e.g. "repos/audit-service"). Flat for v1 --
   * see runs.discover_repos, which only scans 2 levels deep. */
  repos: string[];
  selected: string | null;
  onSelect: (repo: string | null) => void;
}

/**
 * Root-on-top, children-below graph for an orchestrator project's home screen. Connector
 * lines are a percentage-coordinate SVG (viewBox 0-100, preserveAspectRatio="none") so they
 * stretch to match the child grid's actual rendered width with no runtime position
 * measurement -- works for today's flat, one-level layout, and the same per-child branch
 * math extends to real recursive nesting later without a redesign.
 */
export function RepoGraph({ rootLabel, repos, selected, onSelect }: RepoGraphProps) {
  const n = repos.length;

  // A random per-node delay so each node's pulse travels on its own cadence instead of
  // all firing in lockstep -- recomputed only when the repo list itself actually changes,
  // not on every render (a selection change shouldn't restart every pulse's timing).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const delays = useMemo(() => repos.map(() => Math.random() * 2.6), [repos.join("|")]);

  return (
    <div className={styles.graph}>
      <div className={styles.rootRow}>
        <button
          type="button"
          className={styles.root}
          onClick={() => onSelect(null)}
          aria-label={selected ? "Show all repos" : rootLabel}
        >
          <SectionLabel>Orchestrator</SectionLabel>
          <span className={styles.rootName}>{rootLabel}</span>
        </button>
      </div>

      {n > 0 ? (
        <svg
          className={styles.connectors}
          viewBox="0 0 100 56"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          {/* One continuous path per node, root all the way down -- not a shared trunk plus
              separate branch segments, so each node reads as a single line connecting it to
              the orchestrator. Straight, not curved: this box is stretched far more
              horizontally than vertically to match the child row's width
              (preserveAspectRatio="none"), and a curve's curvature isn't scale-invariant
              under that kind of non-uniform stretch (it flattens into a squiggle) -- a
              straight line just changes angle, so it stays clean. `pathLength={1}` normalizes
              each path's length for the pulse's dashoffset animation below, independent of
              its actual on-screen length. */}
          {repos.map((repo, i) => {
            const branchX = ((i + 0.5) / n) * 100;
            const d = `M 50 0 L 50 20 L ${branchX} 56`;
            const isSelected = selected === repo;
            return (
              <g key={repo}>
                <path className={cn(styles.line, isSelected && styles.lineActive)} d={d} />
                {/* Selecting a node "arrives" its connection -- the line lighting up solid
                    is the signal, so the pulse traveling toward it no longer makes sense
                    and is dropped rather than just paused/hidden. */}
                {isSelected ? null : (
                  <path
                    className={styles.pulse}
                    d={d}
                    pathLength={1}
                    style={{ animationDelay: `${delays[i]}s` }}
                  />
                )}
              </g>
            );
          })}
        </svg>
      ) : null}

      <div className={styles.childRow} style={{ gridTemplateColumns: `repeat(${n}, 1fr)` }}>
        {repos.map((repo) => {
          const name = repo.split("/").pop() ?? repo;
          const isSelected = selected === repo;
          return (
            <button
              key={repo}
              type="button"
              className={cn(styles.child, isSelected && styles.childSelected)}
              onClick={() => onSelect(isSelected ? null : repo)}
              title={repo}
            >
              {name}
            </button>
          );
        })}
      </div>
    </div>
  );
}
