import { useCallback, useEffect, useMemo, useState } from "react";
import useEmblaCarousel from "embla-carousel-react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Check, X, ChevronLeft, ChevronRight, ChevronDown, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ServiceLogo } from "@/components/ServiceLogo";
import { useExchangeRates } from "@/hooks/useExchangeRates";
import { cn } from "@/lib/utils";
import {
  displayCategory,
  formatDate,
  formatCurrency,
  isUnknownCurrency,
  FREQUENCY_LABEL,
  FREQUENCY_SUFFIX,
} from "@/lib/format";

export type Decision = "keep" | "skip";

export interface ReviewCard {
  id: string;
  serviceName: string;
  amount: string;
  currency: string;
  frequency: string;
  category: string | null;
  confidence: string;
  reasoning: string | null;
  nextBillingDate: string | Date | null;
  merchantEmail: string | null;
  evidenceLine: string | null;
  duplicateReason: string | null;
}

interface ReviewCarouselProps {
  cards: ReviewCard[];
  /** The currency this person picked, which is what every amount leads with. */
  userCurrency: string;
  confidenceMeta: (confidence: string) => { label: string; cls: string };
  /** Called once, with everything decided, when they choose to save. */
  onSave: (keep: string[], skip: string[]) => void;
  isSaving: boolean;
  /** Back to the table, for anyone who would rather bulk-select. */
  onSwitchToList: () => void;
}

/**
 * Reviewing suggestions one at a time.
 *
 * The list this replaces asked a person to read seventeen dense cards top to
 * bottom and tick boxes. The task is actually sequential and binary -- keep
 * this, skip this, next -- so the screen is now shaped like the task: one
 * card, two buttons, the next one waiting behind it.
 *
 * Nothing is sent while stepping through. Decisions are held here and go in a
 * single call at the end, which buys three things: undo costs nothing, since
 * changing your mind is just going back; abandoning halfway leaves no
 * half-created subscriptions; and the existing batch endpoints are reused
 * exactly as they are.
 */
export function ReviewCarousel({
  cards,
  userCurrency,
  confidenceMeta,
  onSave,
  isSaving,
  onSwitchToList,
}: ReviewCarouselProps) {
  const [emblaRef, embla] = useEmblaCarousel({ align: "center", containScroll: false });
  const [index, setIndex] = useState(0);
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [showReasoning, setShowReasoning] = useState(false);
  const reduceMotion = useReducedMotion();
  const { convert } = useExchangeRates();

  useEffect(() => {
    if (!embla) return;
    const onSelect = () => {
      setIndex(embla.selectedScrollSnap());
      // The explanation is long and belongs to one card. Carrying it open to
      // the next one would undo the point of folding it away.
      setShowReasoning(false);
    };
    embla.on("select", onSelect);
    return () => {
      embla.off("select", onSelect);
    };
  }, [embla]);

  /*
   * Saving removes those suggestions from the list, so the slide count changes
   * underneath the carousel. Embla measures its slides once at setup and does
   * not watch for this, so without a re-init it keeps scrolling against the
   * old count -- which strands the view past the end of a now-shorter list.
   */
  useEffect(() => {
    if (!embla) return;
    embla.reInit();
    const last = Math.max(0, cards.length - 1);
    if (embla.selectedScrollSnap() > last) embla.scrollTo(last);
    setIndex(embla.selectedScrollSnap());
  }, [embla, cards.length]);

  const decide = useCallback(
    (id: string, decision: Decision) => {
      setDecisions((prev) => ({ ...prev, [id]: decision }));
      // Move on, but stop at the end rather than wrapping round to the start,
      // which would quietly re-ask something already answered.
      if (embla && embla.canScrollNext()) embla.scrollNext();
    },
    [embla]
  );

  const current = cards[index];

  useEffect(() => {
    if (!current) return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (target?.isContentEditable) return;
      // Ctrl+S and Cmd+K belong to the browser. Claiming a bare letter is
      // fine; claiming it with a modifier held would break save-page and the
      // address bar.
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      if (event.key === "ArrowRight") embla?.scrollNext();
      else if (event.key === "ArrowLeft") embla?.scrollPrev();
      else if (event.key.toLowerCase() === "k") decide(current.id, "keep");
      else if (event.key.toLowerCase() === "s") decide(current.id, "skip");
      else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [embla, current, decide]);

  /* Counted against the cards on screen, not against every id ever decided.
     A save removes those suggestions from the list, and their decisions have
     to stop counting with them or the button offers to save work already
     done. */
  const decidedCount = cards.filter((c) => decisions[c.id]).length;
  const keepIds = useMemo(
    () => cards.filter((c) => decisions[c.id] === "keep").map((c) => c.id),
    [cards, decisions]
  );
  const skipIds = useMemo(
    () => cards.filter((c) => decisions[c.id] === "skip").map((c) => c.id),
    [cards, decisions]
  );

  if (cards.length === 0) return null;

  return (
    <div className="flex flex-col gap-4">
      {/* Progress. A count and a bar, because "3 of 17" answers how much is
          left and the bar answers it without reading. */}
      <div className="flex items-center gap-3">
        <span className="text-[12.5px] font-medium text-ink-body tabular-nums">
          {index + 1} of {cards.length}
        </span>
        <div className="h-1 flex-1 rounded-full bg-line-soft overflow-hidden">
          <motion.div
            className="h-full bg-primary"
            initial={false}
            animate={{ width: `${((index + 1) / cards.length) * 100}%` }}
            transition={reduceMotion ? { duration: 0 } : { type: "spring", stiffness: 260, damping: 30 }}
          />
        </div>
        <span className="text-[11.5px] text-muted-foreground tabular-nums">
          {decidedCount} decided
        </span>
      </div>

      <div className="overflow-hidden" ref={emblaRef}>
        <div className="flex">
          {cards.map((card) => {
            const decision = decisions[card.id];
            const confidence = confidenceMeta(card.confidence);
            const category = displayCategory(card.category);
            const frequencyLabel = FREQUENCY_LABEL[card.frequency] ?? card.frequency;
            const frequencySuffix = FREQUENCY_SUFFIX[card.frequency] ?? "";
            const billed = parseFloat(card.amount) || 0;
            const unknownCurrency = isUnknownCurrency(card.currency);
            const converted = unknownCurrency ? null : convert(billed, card.currency, userCurrency);
            // Only worth showing twice when the two differ. A dollar
            // subscription for someone who bills in dollars is one number.
            const showOriginal = converted !== null && card.currency.toUpperCase() !== userCurrency.toUpperCase();
            const isCurrent = cards[index]?.id === card.id;

            return (
              <div key={card.id} className="min-w-0 shrink-0 grow-0 basis-full px-2 sm:basis-[520px] sm:max-w-full">
                <motion.div
                  initial={false}
                  animate={{
                    scale: reduceMotion ? 1 : isCurrent ? 1 : 0.94,
                    opacity: isCurrent ? 1 : 0.45,
                  }}
                  transition={reduceMotion ? { duration: 0 } : { type: "spring", stiffness: 300, damping: 30 }}
                  className={cn(
                    "surface-card p-5 flex flex-col gap-4 relative",
                    decision === "keep" && "ring-2 ring-success",
                    decision === "skip" && "ring-2 ring-line-soft opacity-70"
                  )}
                  data-testid={`review-card-${card.id}`}
                >
                  {/* A decision already made has to be visible on the card
                      itself, or going back to check one means guessing. */}
                  <AnimatePresence>
                    {decision && (
                      <motion.span
                        initial={reduceMotion ? false : { opacity: 0, y: -4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={reduceMotion ? undefined : { opacity: 0 }}
                        className={cn(
                          "absolute right-4 top-4 badge-status",
                          decision === "keep" ? "status-active" : "status-cancelled"
                        )}
                        data-testid={`decision-${card.id}`}
                      >
                        {decision === "keep" ? "Keeping" : "Skipping"}
                      </motion.span>
                    )}
                  </AnimatePresence>

                  <div className="flex items-start gap-3">
                    <ServiceLogo name={card.serviceName} merchantEmail={card.merchantEmail} size={44} />
                    <div className="min-w-0 flex-1">
                      <p className="t-card-title truncate pr-20">{card.serviceName}</p>
                      <p className="text-[12px] text-muted-foreground">{frequencyLabel}</p>
                    </div>
                  </div>

                  {/* The amount, in the currency they picked, with what was
                      actually billed underneath it. */}
                  <div>
                    <p className="t-price text-[26px] leading-none tabular-nums">
                      {converted !== null
                        ? formatCurrency(converted, userCurrency)
                        : formatCurrency(billed, card.currency)}
                      <span className="text-[13px] font-medium text-muted-foreground">{frequencySuffix}</span>
                    </p>
                    {showOriginal && (
                      <p className="mt-1 text-[11.5px] text-muted-foreground tabular-nums">
                        billed {formatCurrency(billed, card.currency)}
                      </p>
                    )}
                    {unknownCurrency && (
                      <p className="mt-1 text-[11.5px] text-warning">
                        No currency printed on the receipt — worth a check before keeping.
                      </p>
                    )}
                  </div>

                  <div className="flex flex-wrap gap-[5px]">
                    {category && <span className="badge-category">{category}</span>}
                    <span className={cn("badge-status", confidence.cls)}>{confidence.label}</span>
                    {unknownCurrency && <span className="badge-status status-trial">Check currency</span>}
                    {card.duplicateReason && (
                      <span className="badge-status status-review" title={card.duplicateReason}>
                        Possible duplicate
                      </span>
                    )}
                  </div>

                  {card.nextBillingDate && (
                    <p className="text-[12px] text-ink-body">
                      Next charge {formatDate(card.nextBillingDate)}
                    </p>
                  )}

                  {card.evidenceLine && (
                    <p className="text-[11.5px] text-muted-foreground truncate">{card.evidenceLine}</p>
                  )}

                  {/* The reasoning paragraph is what made the old list a wall
                      of text. It is still the answer to "why do you think
                      this", so it stays -- one tap away instead of in the way. */}
                  {isCurrent && card.reasoning && (
                    <div>
                      <button
                        type="button"
                        onClick={() => setShowReasoning((v) => !v)}
                        className="flex items-center gap-1 text-[12px] font-medium text-primary"
                        data-testid="toggle-reasoning"
                      >
                        Why we think this
                        <ChevronDown
                          className={cn("h-3.5 w-3.5 transition-transform", showReasoning && "rotate-180")}
                        />
                      </button>
                      <AnimatePresence initial={false}>
                        {showReasoning && (
                          <motion.p
                            initial={reduceMotion ? false : { height: 0, opacity: 0 }}
                            animate={{ height: "auto", opacity: 1 }}
                            exit={reduceMotion ? undefined : { height: 0, opacity: 0 }}
                            className="overflow-hidden text-[12.5px] text-ink-body"
                          >
                            <span className="block pt-2">{card.reasoning}</span>
                          </motion.p>
                        )}
                      </AnimatePresence>
                    </div>
                  )}
                </motion.div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Decide. Two buttons, the size of the decision they carry. */}
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="icon"
          onClick={() => embla?.scrollPrev()}
          disabled={index === 0}
          aria-label="Previous suggestion"
          data-testid="carousel-prev"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>

        <Button
          variant="outline"
          className="flex-1"
          onClick={() => current && decide(current.id, "skip")}
          data-testid="button-skip"
        >
          <X className="mr-1.5 h-4 w-4" />
          Skip
        </Button>
        <Button
          className="flex-1"
          onClick={() => current && decide(current.id, "keep")}
          data-testid="button-keep"
        >
          <Check className="mr-1.5 h-4 w-4" />
          Keep
        </Button>

        <Button
          variant="outline"
          size="icon"
          onClick={() => embla?.scrollNext()}
          disabled={index >= cards.length - 1}
          aria-label="Next suggestion"
          data-testid="carousel-next"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onSwitchToList}
            className="text-[12px] font-medium text-muted-foreground underline underline-offset-2"
            data-testid="switch-to-list"
          >
            Review as a list
          </button>
          {decidedCount > 0 && (
            <button
              type="button"
              onClick={() => setDecisions({})}
              className="flex items-center gap-1 text-[12px] font-medium text-muted-foreground"
              data-testid="clear-decisions"
            >
              <RotateCcw className="h-3 w-3" />
              Start over
            </button>
          )}
        </div>

        <Button
          onClick={() => onSave(keepIds, skipIds)}
          disabled={decidedCount === 0 || isSaving}
          data-testid="button-save-decisions"
        >
          {isSaving
            ? "Saving…"
            : `Save ${decidedCount} decision${decidedCount === 1 ? "" : "s"}`}
        </Button>
      </div>

      <p className="text-[11px] text-muted-foreground">
        Nothing is saved until you press save. <kbd>K</kbd> to keep, <kbd>S</kbd> to skip,
        arrow keys to move.
      </p>
    </div>
  );
}
