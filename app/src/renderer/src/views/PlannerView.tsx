import { useState, useEffect, useMemo, useCallback } from "react";
import { Inbox, ChevronDown, ChevronRight, Minus, Plus, TriangleAlert, Info } from "lucide-react";
import { useT } from "~/lib/i18n";
import type { Translate } from "../../../shared/i18n/index.js";
import { cn } from "~/lib/utils";
import { HeroPortrait } from "~/components/HeroPortrait";
import { formatEta, modeTextClass } from "~/lib/format";
import { stageCode, stageDifficulty, heroName } from "~/lib/game-data";
import {
  loadPlannerInputs,
  type PlannerInputs,
  type AnchorHero,
  type PlannerCandidate,
} from "~/lib/planner-data";
import {
  singleHeroClimb,
  teamClimb,
  MAX_LEVEL,
  type ClimbHero,
  type PlanBand,
  type TeamPlanBand,
  type ClearConfidence,
  type KeepConfidence,
} from "../../../shared/planner-model.js";
import { expKeepFraction } from "../../../shared/exp-model.js";

/** "team" or a specific heroKey. */
type Subject = { kind: "team" } | { kind: "hero"; heroKey: number };

export function PlannerView() {
  const t = useT();
  const [inputs, setInputs] = useState<PlannerInputs | null>(null);
  const [subject, setSubject] = useState<Subject>({ kind: "team" });
  const [target, setTarget] = useState<number | null>(null);

  const load = useCallback(async () => {
    setInputs(await loadPlannerInputs());
  }, []);

  useEffect(() => {
    void load();
    return window.meter.onRunsChanged(() => void load());
  }, [load]);

  // The heroes that can climb (level < MAX_LEVEL). Capped heroes are shown greyed but excluded.
  const climbers = useMemo(() => (inputs?.team ?? []).filter((h) => h.level < MAX_LEVEL), [inputs]);
  const minTarget = useMemo(
    () => (climbers.length ? Math.min(MAX_LEVEL, Math.max(...climbers.map((h) => h.level)) + 1) : MAX_LEVEL),
    [climbers],
  );

  // Default target: a round number above the lowest climber, clamped to MAX_LEVEL.
  const effectiveTarget = useMemo(() => {
    if (target != null) return Math.min(MAX_LEVEL, Math.max(minTarget, target));
    const suggestion = Math.min(MAX_LEVEL, Math.ceil((minTarget + 1) / 5) * 5);
    return Math.max(minTarget, suggestion);
  }, [target, minTarget]);

  // Reset a stale hero-subject if its hero capped or vanished after a reload.
  useEffect(() => {
    if (subject.kind === "hero" && !climbers.some((h) => h.heroKey === subject.heroKey)) {
      setSubject({ kind: "team" });
    }
  }, [subject, climbers]);

  if (inputs == null) {
    return <div className="flex flex-1 items-center justify-center text-sm text-zinc-500">…</div>;
  }

  // Empty / cold-start gate: no counted runs (no DPS, every stage uncalibrated T3) → don't pretend.
  if (inputs.countedRuns === 0 || inputs.partyDpsNow <= 0 || inputs.team.length === 0) {
    return <EmptyState t={t} />;
  }

  // Capped-only team.
  if (climbers.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-1 px-8 text-center">
        <span className="text-sm font-semibold text-zinc-300">{t("planner.maxedTitle")}</span>
        <span className="text-xs text-zinc-500">{t("planner.maxedBody")}</span>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-y-auto px-3 py-3 text-sm">
      <SubjectPicker
        t={t}
        team={inputs.team}
        subject={subject}
        onSubject={setSubject}
      />

      <TargetStepper
        t={t}
        value={effectiveTarget}
        min={minTarget}
        onChange={(v) => setTarget(v)}
      />

      <p className="mb-3 text-[11px] text-zinc-500">
        {t("planner.contextLine", {
          dps: humanizeDps(inputs.partyDpsNow),
          runs: inputs.countedRuns,
          stages: inputs.calibratedStages,
        })}
      </p>

      <PlanPanel t={t} inputs={inputs} subject={subject} target={effectiveTarget} climbers={climbers} />
    </div>
  );
}

// ── empty state ────────────────────────────────────────────────────────────────────────────

function EmptyState({ t }: { t: Translate }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 px-10 text-center">
      <Inbox className="size-8 text-zinc-600" />
      <span className="text-sm font-semibold text-zinc-300">{t("planner.emptyTitle")}</span>
      <span className="max-w-md text-xs leading-relaxed text-zinc-500">{t("planner.emptyBody")}</span>
    </div>
  );
}

// ── subject picker (Team | per-hero) ─────────────────────────────────────────────────────────

function SubjectPicker({
  t,
  team,
  subject,
  onSubject,
}: {
  t: Translate;
  team: AnchorHero[];
  subject: Subject;
  onSubject: (s: Subject) => void;
}) {
  return (
    <div className="mb-3 flex flex-wrap items-center gap-1.5">
      <button
        type="button"
        onClick={() => onSubject({ kind: "team" })}
        className={cn(
          "cursor-pointer rounded px-2.5 py-1 text-xs font-medium transition-colors",
          subject.kind === "team" ? "bg-brand-600 text-white" : "bg-surface-700 text-zinc-300 hover:bg-surface-600",
        )}
      >
        {t("planner.subjectTeam")}
      </button>
      {team.map((h) => {
        const capped = h.level >= MAX_LEVEL;
        const active = subject.kind === "hero" && subject.heroKey === h.heroKey;
        return (
          <button
            key={h.heroKey}
            type="button"
            disabled={capped}
            onClick={() => onSubject({ kind: "hero", heroKey: h.heroKey })}
            title={`${h.class} · Lv ${h.level}`}
            className={cn(
              "flex cursor-pointer items-center gap-1.5 rounded py-0.5 pl-0.5 pr-2 text-xs font-medium transition-colors",
              capped && "cursor-default opacity-50",
              active ? "bg-brand-600 text-white" : "bg-surface-700 text-zinc-300 hover:bg-surface-600",
            )}
          >
            <HeroPortrait heroKey={h.heroKey} heroClass={h.class} />
            <span className="tabular-nums">Lv {h.level}</span>
            {capped && <span className="rounded bg-amber-500/20 px-1 text-[9px] font-bold text-amber-300">{t("planner.maxPill")}</span>}
          </button>
        );
      })}
    </div>
  );
}

// ── target stepper ─────────────────────────────────────────────────────────────────────────

function TargetStepper({
  t,
  value,
  min,
  onChange,
}: {
  t: Translate;
  value: number;
  min: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="mb-2 flex items-center gap-2">
      <span className="text-xs text-zinc-400">{t("planner.targetLabel")}</span>
      <div className="flex items-center gap-1">
        <StepBtn disabled={value <= min} onClick={() => onChange(Math.max(min, value - 1))}>
          <Minus className="size-3" />
        </StepBtn>
        <span className="w-9 text-center font-mono text-sm font-bold tabular-nums text-white">{value}</span>
        <StepBtn disabled={value >= MAX_LEVEL} onClick={() => onChange(Math.min(MAX_LEVEL, value + 1))}>
          <Plus className="size-3" />
        </StepBtn>
      </div>
    </div>
  );
}

function StepBtn({ children, disabled, onClick }: { children: React.ReactNode; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="flex size-6 cursor-pointer items-center justify-center rounded bg-surface-700 text-zinc-300 transition-colors hover:bg-surface-600 disabled:cursor-default disabled:opacity-40"
    >
      {children}
    </button>
  );
}

// ── the plan panel (computes + renders the schedule) ─────────────────────────────────────────

function PlanPanel({
  t,
  inputs,
  subject,
  target,
  climbers,
}: {
  t: Translate;
  inputs: PlannerInputs;
  subject: Subject;
  target: number;
  climbers: AnchorHero[];
}) {
  const [showPerHero, setShowPerHero] = useState(false);

  const climbHeroes = useMemo<ClimbHero[]>(
    () =>
      inputs.team.map((h) => ({
        heroKey: h.heroKey,
        level: h.level,
        expIntoLevel: h.expIntoLevel,
        bonusPct: h.bonusPct,
      })),
    [inputs.team],
  );

  const computed = useMemo(() => {
    if (subject.kind === "hero") {
      const hero = climbHeroes.find((h) => h.heroKey === subject.heroKey);
      if (!hero) return null;
      const plan = singleHeroClimb(hero, target, inputs.candidates, inputs.curve, inputs.accountXpMultiplier, {
        excludeUnderLevel: true,
      });
      return { kind: "hero" as const, plan };
    }
    const teamPlan = teamClimb(climbHeroes, target, inputs.candidates, inputs.curve, inputs.accountXpMultiplier, {
      excludeUnderLevel: true,
    });
    return { kind: "team" as const, teamPlan };
  }, [subject, climbHeroes, target, inputs]);

  if (!computed) return null;

  const candByKey = new Map(inputs.candidates.map((c) => [c.stageKey, c]));

  const subjectLabel =
    subject.kind === "team"
      ? t("planner.subjectTeam")
      : `${heroClassOf(inputs.team, subject.heroKey)}`;

  const bands: (PlanBand | TeamPlanBand)[] =
    computed.kind === "team" ? computed.teamPlan.bands : computed.plan.bands;
  const totalSeconds = computed.kind === "team" ? computed.teamPlan.totalSeconds : computed.plan.totalSeconds;
  const status = computed.kind === "team" ? computed.teamPlan.status : computed.plan.status;

  if (status === "already-at-target") {
    return <p className="text-xs text-zinc-500">{t("planner.alreadyThere")}</p>;
  }

  // honesty banners (which apply to the *current* plan's bands)
  const anyEstimated = bands.some((b) => b.clearTier === 3);
  const anyUnderLevel = bands.some((b) => b.keepConfidence === "approx");

  return (
    <div>
      {/* Plan header */}
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="text-sm font-semibold text-zinc-100">
          {t("planner.planFor", { subject: subjectLabel, target })}
        </span>
        <span className="text-xs text-zinc-500">
          {t("planner.atCurrentDps")} · {t("planner.totalRough", { time: formatEta(totalSeconds) })}
        </span>
      </div>

      {/* Global banners (the honesty layer) */}
      <div className="mb-2 flex flex-col gap-1">
        <Banner tone="info" icon={<Info className="size-3.5" />}>{t("planner.bannerDps")}</Banner>
        {inputs.anyBonusMissing && (
          <Banner tone="info" icon={<Info className="size-3.5" />}>{t("planner.bannerBonus")}</Banner>
        )}
        <Banner tone="info" icon={<Info className="size-3.5" />}>{t("planner.bannerAccount")}</Banner>
        {anyEstimated && (
          <Banner tone="info" icon={<Info className="size-3.5" />}>{t("planner.bannerEstimated")}</Banner>
        )}
        {anyUnderLevel && (
          <Banner tone="warn" icon={<TriangleAlert className="size-3.5" />}>{t("planner.bannerUnderLevel")}</Banner>
        )}
      </div>

      {status === "no-farmable-stage" ? (
        <Banner tone="warn" icon={<TriangleAlert className="size-3.5" />}>
          {t("planner.noFarmStage", { level: subject.kind === "hero" ? climberLevel(climbers, subject.heroKey) : target })}
        </Banner>
      ) : (
        <BandTable t={t} bands={bands} candByKey={candByKey} />
      )}

      {/* gated-by (team only) */}
      {computed.kind === "team" && computed.teamPlan.gatedByHeroKey != null && status === "ok" && (
        <p className="mt-2 text-[11px] text-zinc-500">
          {t("planner.gatedBy", { hero: heroLabel(computed.teamPlan.gatedByHeroKey, inputs.team) })}
        </p>
      )}

      {/* per-hero breakdown (team only) */}
      {computed.kind === "team" && (
        <div className="mt-3">
          <button
            type="button"
            onClick={() => setShowPerHero((v) => !v)}
            className="flex cursor-pointer items-center gap-1 text-xs font-medium text-zinc-400 hover:text-zinc-200"
          >
            {showPerHero ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
            {t("planner.perHeroBreakdown")}
          </button>
          {showPerHero && (
            <div className="mt-2 flex flex-col gap-3 border-l border-surface-700 pl-3">
              {computed.teamPlan.perHero.map((hp) => {
                const finish = computed.teamPlan.perHeroFinishSeconds[hp.heroKey];
                return (
                  <div key={hp.heroKey}>
                    <div className="mb-1 flex items-baseline gap-2">
                      <span className="text-xs font-semibold text-zinc-200">{heroLabel(hp.heroKey, inputs.team)}</span>
                      <span className="text-[11px] text-zinc-500">
                        {t("planner.heroFinish", { hero: "", time: formatEta(finish ?? hp.totalSeconds) }).replace(": ", "")}
                      </span>
                    </div>
                    {hp.status === "ok" ? (
                      <BandTable t={t} bands={hp.bands} candByKey={candByKey} compact />
                    ) : (
                      <span className="text-[11px] text-zinc-500">
                        {hp.status === "already-at-target" ? t("planner.alreadyThere") : t("planner.noFarmStage", { level: climberLevel(climbers, hp.heroKey) })}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── the band schedule table ──────────────────────────────────────────────────────────────────

function BandTable({
  t,
  bands,
  candByKey,
  compact,
}: {
  t: Translate;
  bands: (PlanBand | TeamPlanBand)[];
  candByKey: Map<number, PlannerCandidate>;
  compact?: boolean;
}) {
  if (bands.length === 0) return null;
  return (
    <div className="overflow-x-auto rounded border border-surface-700">
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr className="border-b border-surface-700 bg-surface-800/60 text-left text-[10px] uppercase tracking-wide text-zinc-500">
            <th className="px-2 py-1 font-medium">{t("planner.colLevels")}</th>
            <th className="px-2 py-1 font-medium">{t("planner.colStage")}</th>
            <th className="px-2 py-1 text-right font-medium">{t("planner.colTime")}</th>
            {!compact && <th className="px-2 py-1 font-medium">{t("planner.colNotes")}</th>}
          </tr>
        </thead>
        <tbody>
          {bands.map((b, i) => {
            const cand = candByKey.get(b.stageKey);
            const code = stageCode(b.stageKey) ?? `#${b.stageKey}`;
            const mode = stageDifficulty(b.stageKey);
            const keepPct = cand ? keepPctFor(b, cand) : null;
            return (
              <tr key={`${b.fromLevel}-${i}`} className="border-b border-surface-700/50 last:border-0">
                <td className="whitespace-nowrap px-2 py-1.5 font-mono tabular-nums text-zinc-300">
                  {b.fromLevel} → {b.toLevel}
                </td>
                <td className="whitespace-nowrap px-2 py-1.5">
                  <span className="font-semibold text-zinc-200">{code}</span>{" "}
                  {mode && <span className={cn("text-[10px] font-bold uppercase", modeTextClass(mode))}>{mode}</span>}
                  <span className="ml-1 text-[10px] text-zinc-500">(L{b.stageLevel})</span>
                </td>
                <td className="whitespace-nowrap px-2 py-1.5 text-right font-mono tabular-nums text-zinc-300">
                  {formatEta(b.seconds)}
                </td>
                {!compact && (
                  <td className="px-2 py-1.5">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {keepPct != null && <span className="text-zinc-400">{t("planner.keepPct", { pct: keepPct })}</span>}
                      <ClearBadge t={t} confidence={b.clearConfidence} />
                      {b.keepConfidence !== "solid" && <KeepBadge t={t} keep={b.keepConfidence} />}
                    </div>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── badges ────────────────────────────────────────────────────────────────────────────────

const CLEAR_GLYPH: Record<ClearConfidence, string> = {
  measured: "●",
  "measured-thin": "◑",
  "estimated-calibrated": "◔",
  estimated: "○",
  none: "—",
};

function ClearBadge({ t, confidence }: { t: Translate; confidence: ClearConfidence }) {
  const label =
    confidence === "measured"
      ? t("planner.confMeasured")
      : confidence === "measured-thin"
        ? t("planner.confMeasuredThin")
        : confidence === "estimated-calibrated"
          ? t("planner.confEstimatedCalibrated")
          : confidence === "estimated"
            ? t("planner.confEstimated")
            : "—";
  const tip =
    confidence === "measured"
      ? t("planner.confMeasuredTip")
      : confidence === "measured-thin"
        ? t("planner.confMeasuredThinTip")
        : t("planner.confEstimatedTip");
  const tone = confidence === "measured" ? "text-emerald-400" : confidence === "measured-thin" ? "text-sky-300" : "text-amber-300";
  return (
    <span title={tip} className={cn("inline-flex items-center gap-1 text-[10px]", tone)}>
      <span aria-hidden>{CLEAR_GLYPH[confidence]}</span>
      {label}
    </span>
  );
}

function KeepBadge({ t, keep }: { t: Translate; keep: KeepConfidence }) {
  const label = keep === "thin" ? t("planner.keepThin") : t("planner.keepApprox");
  const tip = keep === "thin" ? t("planner.keepThinTip") : t("planner.keepApproxTip");
  return (
    <span title={tip} className="inline-flex items-center gap-1 text-[10px] text-amber-300">
      {label}
    </span>
  );
}

function Banner({ tone, icon, children }: { tone: "info" | "warn"; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div
      className={cn(
        "flex items-start gap-1.5 rounded px-2 py-1 text-[11px] leading-snug",
        tone === "warn" ? "bg-amber-500/10 text-amber-300" : "bg-surface-800/70 text-zinc-400",
      )}
    >
      <span className="mt-px shrink-0">{icon}</span>
      <span>{children}</span>
    </div>
  );
}

// ── helpers ──────────────────────────────────────────────────────────────────────────────────

function humanizeDps(dps: number): string {
  if (dps >= 1e6) return `${(dps / 1e6).toFixed(1)}M`;
  if (dps >= 1e3) return `${(dps / 1e3).toFixed(0)}k`;
  return String(Math.round(dps));
}

function heroClassOf(team: AnchorHero[], heroKey: number): string {
  return team.find((h) => h.heroKey === heroKey)?.class ?? heroName(heroKey);
}

function heroLabel(heroKey: number, team: AnchorHero[]): string {
  const h = team.find((x) => x.heroKey === heroKey);
  return h ? h.class : heroName(heroKey);
}

function climberLevel(climbers: AnchorHero[], heroKey: number): number {
  return climbers.find((h) => h.heroKey === heroKey)?.level ?? 0;
}

/** Keep % shown for a band, from the canonical exp-model curve at the band's START level (where the
 *  gap is smallest; the band may span a couple of levels). Display only — the exact value already
 *  drove the model's rate. Reuses expKeepFraction (no duplicated table). */
function keepPctFor(band: PlanBand, cand: PlannerCandidate): number {
  return Math.round(expKeepFraction(band.fromLevel, cand.stageLevel) * 100);
}
