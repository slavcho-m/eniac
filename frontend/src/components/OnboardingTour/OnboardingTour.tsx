import type { MouseEvent } from "react";
import { useLayoutEffect, useRef, useState } from "react";
import type { ResolvedOnboardingStep } from "@/lib/onboarding";
import { Button } from "../Button/Button";
import styles from "./OnboardingTour.module.css";

interface OnboardingTourProps {
  step: ResolvedOnboardingStep | null;
  stepNumber: number;
  totalSteps: number;
  canGoBack: boolean;
  onNext: () => void;
  onBack: () => void;
  onSkip: () => void;
}

/** Polls the target's rect every frame while a step is active -- handles both a late-
 * mounted element right after a route change (no separate "wait for navigation" step
 * needed) and live tracking through scroll/resize, without a real-page interaction being
 * possible to trigger either (see the click-blocker below). */
function useTargetRect(selector: string | null): DOMRect | null {
  const [rect, setRect] = useState<DOMRect | null>(null);

  useLayoutEffect(() => {
    if (!selector) {
      setRect(null);
      return undefined;
    }
    // Synchronous first check, before paint -- by the time a layout effect runs, a
    // route change from the same click that changed `selector` has already committed
    // its new DOM (React batches the navigate() + step-index update from a single
    // click into one commit), so the new target usually already exists right now. Doing
    // this via the rAF loop below instead (a real fix tried first) means the very first
    // frame always renders with rect still null -- a full re-render showing the card at
    // its centered fallback before snapping to the real spot, i.e. exactly the "briefly
    // teleports to the middle on every Next" regression that fix introduced. Checking
    // synchronously here, before the browser ever paints the null state, skips that
    // frame entirely for every transition where the target is already there.
    const initial = document.querySelector(selector);
    setRect(initial ? initial.getBoundingClientRect() : null);

    let frame: number;
    function measure() {
      const el = selector ? document.querySelector(selector) : null;
      // Sticky once found: a target that legitimately disappears mid-step (e.g. a real
      // dropdown this step spotlights closing as a side effect of the very click meant
      // to advance past it -- Sidebar's own outside-click-closes-menu listener fires on
      // `mousedown`, before the `click` this component's Next button is waiting for)
      // must NOT reset the card to its centered default here. Real bug this caused: the
      // card visibly re-centering *between* mousedown and mouseup made the browser see
      // mismatched click targets, so `click` never fired at all -- Next silently did
      // nothing, over and over, indistinguishable from "stuck on the same step." This
      // loop only ever *adds* a rect once one's found (or updates it on real movement)
      // -- never resets to null -- so a target that hasn't mounted yet (a genuine page
      // navigation, e.g. into the New Project form) still gets picked up once it does,
      // without that same reset-to-centered flash recurring every frame while waiting.
      if (el) {
        setRect((prev) => {
          const next = el.getBoundingClientRect();
          if (
            prev &&
            prev.top === next.top &&
            prev.left === next.left &&
            prev.width === next.width &&
            prev.height === next.height
          ) {
            return prev;
          }
          return next;
        });
      }
      frame = requestAnimationFrame(measure);
    }
    frame = requestAnimationFrame(measure);
    return () => cancelAnimationFrame(frame);
  }, [selector]);

  return rect;
}

const SPOTLIGHT_PADDING = 8;
const VIEWPORT_MARGIN = 16;
const GAP = 12;
const DEFAULT_CARD_SIZE = { width: 320, height: 180 };

// Blocking elements (bands, centerBlocker, the plain full-viewport blocker) visually
// cover the real page and catch `click` via pointer-events, but `mousedown` still
// bubbles past them to `document` regardless -- real bug this caused: clicking a
// blocked area over the real "New Project"/"View All Projects" dropdown never fired
// its onClick (correctly denied), but Sidebar's own outside-click-closes-menu listener
// (a raw `document`-level mousedown listener) still saw the mousedown, decided it was
// "outside" the menu (its target is this blocker div, not a descendant of the menu),
// and closed the real dropdown anyway -- a page-level side effect leaking through a
// click the tour was supposed to be fully denying. Stopping propagation here makes a
// "blocked" step truly inert to the rest of the page, not just visually blocked.
function stopMouseDown(e: MouseEvent) {
  e.stopPropagation();
}

export function OnboardingTour({
  step,
  stepNumber,
  totalSteps,
  canGoBack,
  onNext,
  onBack,
  onSkip,
}: OnboardingTourProps) {
  const rect = useTargetRect(step?.target ?? null);
  // Usually the same selector as the target (resolveStep defaults it that way), so this
  // is a redundant second poll for most steps -- only steps that set `avoid` explicitly
  // (a row inside a still-open real dropdown) get a genuinely different rect back. See
  // the `obstacle` block below for why placement needs this distinct from `spotlight`.
  const avoidRect = useTargetRect(step?.avoid ?? null);
  const cardRef = useRef<HTMLDivElement>(null);
  const [cardSize, setCardSize] = useState(DEFAULT_CARD_SIZE);

  // Real placement (below vs. above the spotlight) depends on the card's actual
  // rendered size, which varies with body length and whether images are present --
  // measured post-render rather than guessed, then only updates state when it actually
  // changed so this doesn't loop.
  useLayoutEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const next = el.getBoundingClientRect();
    setCardSize((prev) =>
      prev.width === next.width && prev.height === next.height
        ? prev
        : { width: next.width, height: next.height },
    );
    // Re-measure whenever the step's own content changes (new title/body/images means a
    // new natural size) -- the equality check above still guards against this looping.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  if (!step) return null;

  const spotlight =
    step.target && rect
      ? {
          top: rect.top - SPOTLIGHT_PADDING,
          left: rect.left - SPOTLIGHT_PADDING,
          width: rect.width + SPOTLIGHT_PADDING * 2,
          height: rect.height + SPOTLIGHT_PADDING * 2,
        }
      : null;
  const allowInteraction = Boolean(step.allowInteraction && spotlight);

  // What the card's placement has to dodge -- usually the same rect as the visual
  // spotlight cutout above, except for steps that spotlight one row inside a still-open
  // real dropdown (avoidRect, from the step's `avoid` selector). That dropdown renders
  // above this whole overlay (see .root's z-index) so a real click can reach it, which
  // means the rest of it stays fully visible no matter how narrow the spotlighted row
  // is -- placing the card by the row's rect alone lands it right on top of the
  // dropdown's other, still-visible rows.
  const obstacle = step.avoid && avoidRect
    ? {
        top: avoidRect.top - SPOTLIGHT_PADDING,
        left: avoidRect.left - SPOTLIGHT_PADDING,
        width: avoidRect.width + SPOTLIGHT_PADDING * 2,
        height: avoidRect.height + SPOTLIGHT_PADDING * 2,
      }
    : spotlight;

  let cardStyle: { position: "fixed"; transform: string; top: number; left: number } | undefined;
  if (obstacle) {
    // Four candidate placements, not just below/above -- a step that spotlights an
    // entire column (the whole sidebar, the whole main content area) leaves almost no
    // room above or below it no matter how tall the card is, so a below/above-only rule
    // pins the card into a sliver of space and it ends up overlapping the very thing
    // it's explaining. Reading-order preference (below, right, above, left) among
    // whichever sides actually fit; if none do (spotlight fills the viewport on both
    // axes), falls back to whichever side has the most room rather than defaulting to
    // "below" and guaranteeing an overlap.
    const candidates = [
      {
        space: window.innerHeight - (obstacle.top + obstacle.height),
        top: obstacle.top + obstacle.height + GAP,
        left: obstacle.left,
        fits: (space: number) => space >= cardSize.height + GAP,
      },
      {
        space: window.innerWidth - (obstacle.left + obstacle.width),
        top: obstacle.top,
        left: obstacle.left + obstacle.width + GAP,
        fits: (space: number) => space >= cardSize.width + GAP,
      },
      {
        space: obstacle.top,
        top: obstacle.top - cardSize.height - GAP,
        left: obstacle.left,
        fits: (space: number) => space >= cardSize.height + GAP,
      },
      {
        space: obstacle.left,
        top: obstacle.top,
        left: obstacle.left - cardSize.width - GAP,
        fits: (space: number) => space >= cardSize.width + GAP,
      },
    ];
    const chosen =
      candidates.find((c) => c.fits(c.space)) ??
      candidates.reduce((best, c) => (c.space > best.space ? c : best));

    cardStyle = {
      position: "fixed",
      // .card's CSS class centers by default via `transform: translate(-50%, -50%)`
      // treating top/left as the *center* point -- reset here since these top/left
      // values are the card's actual top-left corner instead.
      transform: "none",
      top: Math.min(Math.max(chosen.top, VIEWPORT_MARGIN), window.innerHeight - cardSize.height - VIEWPORT_MARGIN),
      left: Math.min(Math.max(chosen.left, VIEWPORT_MARGIN), window.innerWidth - cardSize.width - VIEWPORT_MARGIN),
    };
  }

  return (
    <div className={styles.root}>
      {spotlight ? (
        <div
          className={styles.spotlight}
          style={{ top: spotlight.top, left: spotlight.left, width: spotlight.width, height: spotlight.height }}
        />
      ) : (
        <div
          className={styles.fullDim}
          style={step.allowInteraction ? { pointerEvents: "none" } : undefined}
          onMouseDown={stopMouseDown}
          role="presentation"
        />
      )}

      {spotlight ? (
        <>
          {/* Bands only cover the 4 regions *around* the spotlighted rect -- unlike a
           * single full-viewport blocker, they never repaint over the hole the spotlight
           * div above just cut, in either interaction mode. */}
          <div
            className={styles.blockerBand}
            style={{ top: 0, left: 0, right: 0, height: spotlight.top }}
            onMouseDown={stopMouseDown}
            role="presentation"
          />
          <div
            className={styles.blockerBand}
            style={{ top: spotlight.top + spotlight.height, left: 0, right: 0, bottom: 0 }}
            onMouseDown={stopMouseDown}
            role="presentation"
          />
          <div
            className={styles.blockerBand}
            style={{ top: spotlight.top, left: 0, width: spotlight.left, height: spotlight.height }}
            onMouseDown={stopMouseDown}
            role="presentation"
          />
          <div
            className={styles.blockerBand}
            style={{
              top: spotlight.top,
              left: spotlight.left + spotlight.width,
              right: 0,
              height: spotlight.height,
            }}
            onMouseDown={stopMouseDown}
            role="presentation"
          />
          {/* Invisible click-catcher exactly over the hole -- present for every ordinary
           * step (blocks a real click reaching the spotlighted element) and omitted only
           * for interactive steps, where reaching the real element is the whole point. */}
          {allowInteraction ? null : (
            <div
              className={styles.centerBlocker}
              style={{ top: spotlight.top, left: spotlight.left, width: spotlight.width, height: spotlight.height }}
              onMouseDown={stopMouseDown}
              role="presentation"
            />
          )}
        </>
      ) : (
        <div
          className={styles.blocker}
          style={step.allowInteraction ? { pointerEvents: "none" } : undefined}
          onMouseDown={stopMouseDown}
          role="presentation"
        />
      )}

      {/* Same reasoning as stopMouseDown on the blockers above -- without this, clicking
       * Next/Back/Skip while a step is narrating a real open dropdown (the project menu,
       * the mode menu) sends a mousedown that bubbles to `document`, and that dropdown's
       * own outside-click-closes-menu listener reads "click landed on the tour card" as
       * "click landed outside the menu" and closes it -- right before the very next step
       * tries to spotlight an option inside it. The div itself isn't the interactive
       * control -- its real heading/buttons are -- this handler only stops a native
       * event from bubbling past it, hence the disable. */}
      {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
      <div ref={cardRef} className={styles.card} style={cardStyle} onMouseDown={stopMouseDown}>
        <p className={styles.progress}>
          {stepNumber} / {totalSteps}
        </p>
        <h3 className={styles.title}>{step.title}</h3>
        <p className={styles.body}>{step.body}</p>
        <div className={styles.actions}>
          <button type="button" className={styles.skip} onClick={onSkip}>
            Skip tour
          </button>
          <div className={styles.navButtons}>
            {canGoBack ? (
              <Button variant="secondary" onClick={onBack}>
                Back
              </Button>
            ) : null}
            {step.hideNext ? null : (
              <Button variant="primary" onClick={onNext}>
                {stepNumber === totalSteps ? "Finish" : "Next"}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
