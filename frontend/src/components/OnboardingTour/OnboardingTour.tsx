import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { docsImageUrl } from "@/lib/api";
import { cn } from "@/lib/cn";
import type { OnboardingStep } from "@/lib/onboarding";
import { Button } from "../Button/Button";
import styles from "./OnboardingTour.module.css";

interface OnboardingTourProps {
  step: OnboardingStep | null;
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

  useEffect(() => {
    if (!selector) {
      setRect(null);
      return undefined;
    }
    let frame: number;
    function measure() {
      const el = selector ? document.querySelector(selector) : null;
      setRect((prev) => {
        if (!el) return null;
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

  let cardStyle: { position: "fixed"; transform: string; top: number; left: number } | undefined;
  if (spotlight) {
    const spaceBelow = window.innerHeight - (spotlight.top + spotlight.height);
    const spaceAbove = spotlight.top;
    // Prefer below (matches reading order); flip above only when there's genuinely more
    // room there, so the card never has to fight the target for the same few pixels.
    const placeBelow = spaceBelow >= cardSize.height + GAP || spaceBelow >= spaceAbove;
    const top = placeBelow
      ? Math.min(spotlight.top + spotlight.height + GAP, window.innerHeight - cardSize.height - VIEWPORT_MARGIN)
      : Math.max(spotlight.top - cardSize.height - GAP, VIEWPORT_MARGIN);
    cardStyle = {
      position: "fixed",
      // .card's CSS class centers by default via `transform: translate(-50%, -50%)`
      // treating top/left as the *center* point -- reset here since these top/left
      // values are the card's actual top-left corner instead.
      transform: "none",
      top,
      left: Math.min(Math.max(spotlight.left, VIEWPORT_MARGIN), window.innerWidth - cardSize.width - VIEWPORT_MARGIN),
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
        <div className={styles.fullDim} style={step.allowInteraction ? { pointerEvents: "none" } : undefined} />
      )}

      {spotlight ? (
        <>
          {/* Bands only cover the 4 regions *around* the spotlighted rect -- unlike a
           * single full-viewport blocker, they never repaint over the hole the spotlight
           * div above just cut, in either interaction mode. */}
          <div className={styles.blockerBand} style={{ top: 0, left: 0, right: 0, height: spotlight.top }} />
          <div
            className={styles.blockerBand}
            style={{ top: spotlight.top + spotlight.height, left: 0, right: 0, bottom: 0 }}
          />
          <div
            className={styles.blockerBand}
            style={{ top: spotlight.top, left: 0, width: spotlight.left, height: spotlight.height }}
          />
          <div
            className={styles.blockerBand}
            style={{
              top: spotlight.top,
              left: spotlight.left + spotlight.width,
              right: 0,
              height: spotlight.height,
            }}
          />
          {/* Invisible click-catcher exactly over the hole -- present for every ordinary
           * step (blocks a real click reaching the spotlighted element) and omitted only
           * for interactive steps, where reaching the real element is the whole point. */}
          {allowInteraction ? null : (
            <div
              className={styles.centerBlocker}
              style={{ top: spotlight.top, left: spotlight.left, width: spotlight.width, height: spotlight.height }}
            />
          )}
        </>
      ) : (
        <div className={styles.blocker} style={step.allowInteraction ? { pointerEvents: "none" } : undefined} />
      )}

      <div ref={cardRef} className={cn(styles.card, step.images && styles.cardWide)} style={cardStyle}>
        <p className={styles.progress}>
          {stepNumber} / {totalSteps}
        </p>
        <h3 className={styles.title}>{step.title}</h3>
        <p className={styles.body}>{step.body}</p>
        {step.images ? (
          <div className={styles.images}>
            {step.images.map((image) => (
              <figure key={image.src + image.caption} className={styles.figure}>
                <img
                  src={docsImageUrl(image.src.replace(/^images\//, ""))}
                  alt={image.caption}
                  className={styles.image}
                />
                <figcaption className={styles.caption}>{image.caption}</figcaption>
              </figure>
            ))}
          </div>
        ) : null}
        {step.hint ? <p className={styles.hint}>{step.hint}</p> : null}
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
