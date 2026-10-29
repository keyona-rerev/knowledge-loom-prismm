import { invokeQueued } from "@/lib/invokeQueued";
import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { ArrowLeft, Sparkles, Lightbulb, FileText } from "lucide-react";
import {
  bindGenerationJob,
  buildPendingHandle,
  classifyAdmissionError,
  classifyCreateContentError,
  finalRunErrorAction,
  interpretConsumeResult,
  invokeInputFields,
  isTerminalHandle,
  markHandleTerminal,
  mintRequestKey,
  invokeErrorMessage,
  clearCreateContentHandleForRun,
  writeCreateContentHandleForRun,
  listCreateContentHandles,
  readRunHandle,
  isSameRun,
  parseInputMismatch,
  parseFailedReplay,
  readInvokeErrorBody,
  reconcileAction,
  runIdentityOf,
  sameDirection,
  sameInputs,
  type ContentDirection,
  type CreateContentHandle,
  type CreateContentInputs,
} from "@/lib/createContentRecovery";

interface InsightCard {
  id: string;
  title: string;
  content: string;
  insight_type: string;
}

// Strategy library rows - same tables the Strategy page and the schedule
// autopilot read, so manual content creation can align with them too.
interface NamedRow { id: string; name: string; }
interface FormatRow extends NamedRow { key: string; }

const NONE = "__none__";

const DIRECTIONS_FN = "generate-content-directions";
const FINAL_FN = "generate-final-content";
const CONSUME_FN = "consume-final-job"; // contract G4: body { jobId } only

const CreateContent = () => {
  const navigate = useNavigate();

  const [seedInsight, setSeedInsight] = useState("");
  const [seedCategory, setSeedCategory] = useState<string>("thesis");
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<"input" | "directions" | "cards">("input");

  // Strategy library: same formats/natures/jobs the Strategy page and the
  // schedule autopilot read, offered here as optional context so manually
  // created content can align with them too.
  const [formats, setFormats] = useState<FormatRow[]>([]);
  const [natures, setNatures] = useState<NamedRow[]>([]);
  const [jobs, setJobs] = useState<NamedRow[]>([]);
  const [selectedFormat, setSelectedFormat] = useState<string>(NONE);
  const [selectedNature, setSelectedNature] = useState<string>(NONE);
  const [selectedJob, setSelectedJob] = useState<string>(NONE);

  // NEW STATE: Insight cards integration
  const [insightCards, setInsightCards] = useState<InsightCard[]>([]);
  const [selectedInsightCards, setSelectedInsightCards] = useState<string[]>([]);
  const [showInsightSelection, setShowInsightSelection] = useState(false);

  // Durable in-flight generation run (see src/lib/createContentRecovery.ts):
  // mirrors the stored handle so the page can offer Resume / Discard after a
  // reload or a transient status failure instead of losing the job.
  const [savedRun, setSavedRun] = useState<CreateContentHandle | null>(null);
  // ALL recoverable runs for this account (per-run storage slots), newest
  // first. savedRun is the SELECTED one; the others stay discoverable and
  // selectable - the newest alone is not closure.
  const [savedRuns, setSavedRuns] = useState<CreateContentHandle[]>([]);
  const uidRef = useRef("");
  // A 409 INPUT_MISMATCH (contract G3): this requestKey was admitted
  // server-side with DIFFERENT normalized inputs. The stored handle and the
  // restored inputs stay untouched until the user deliberately chooses.
  const [inputMismatch, setInputMismatch] = useState<{
    handle: CreateContentHandle;
    existingGenerationJobId: string | null;
  } | null>(null);
  const runInFlightRef = useRef(false);
  // The "Generating..." progress toast must not outlive the run's drive: it
  // is dismissed on every exit (conflict, terminal, parked, or consumed) so a
  // parked run never LOOKS like it is still actively generating.
  const progressToastRef = useRef<string | number | null>(null);
  const clearProgressToast = () => {
    if (progressToastRef.current != null) {
      toast.dismiss(progressToastRef.current);
      progressToastRef.current = null;
    }
  };

  useEffect(() => {
    const checkAuth = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        navigate("/auth");
      }
    };
    checkAuth();
  }, [navigate]);

  useEffect(() => {
    const loadStrategyLibrary = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const uid = session.user.id;

      const [{ data: fmt }, { data: nat }, { data: jb }] = await Promise.all([
        supabase.from("formats").select("id, name, key").eq("user_id", uid).eq("is_active", true).order("sort_order"),
        supabase.from("natures").select("id, name").eq("user_id", uid).eq("is_active", true).order("sort_order"),
        supabase.from("jobs").select("id, name").eq("user_id", uid).eq("is_active", true).order("sort_order"),
      ]);
      setFormats((fmt || []) as FormatRow[]);
      setNatures((nat || []) as NamedRow[]);
      setJobs((jb || []) as NamedRow[]);
    };

    loadStrategyLibrary();
  }, []);

  const [directions, setDirections] = useState<ContentDirection[]>([]);

  // Snapshot of everything a run was started with, so a resumed run inserts
  // and re-persists from data rather than from possibly-stale UI state.
  const currentInputs = (): CreateContentInputs => ({
    seedInsight,
    seedCategory,
    formatId: selectedFormat !== NONE ? selectedFormat : null,
    natureId: selectedNature !== NONE ? selectedNature : null,
    strategyJobId: selectedJob !== NONE ? selectedJob : null,
    insightCardIds: selectedInsightCards,
  });

  const persistRun = (uid: string, h: CreateContentHandle) => {
    writeCreateContentHandleForRun(localStorage, uid, runIdentityOf(h), h);
    setSavedRun(h);
    setSavedRuns(listCreateContentHandles(localStorage, uid));
  };

  // Identity-conditional storage writes (multi-tab safety): a run finishing,
  // being discarded, or resolving a conflict must never clobber a NEWER run's
  // handle. After every conditional write the banner re-reads storage so it
  // shows the truth (possibly another run's handle) rather than local wishful
  // thinking.
  const refreshSavedRun = (uid: string) => {
    const runs = listCreateContentHandles(localStorage, uid);
    setSavedRuns(runs);
    setSavedRun((cur) => (cur && runs.find((r) => isSameRun(r, cur))) || runs[0] || null);
  };
  const clearRun = (uid: string, identity: string) => {
    clearCreateContentHandleForRun(localStorage, uid, identity);
    refreshSavedRun(uid);
  };
  const updateRun = (uid: string, identity: string, next: (cur: CreateContentHandle) => CreateContentHandle) => {
    // Per-run slots: read and write ONLY this run's own slot. A concurrent
    // run's slot is a different key and cannot be clobbered here.
    const cur = readRunHandle(localStorage, uid, identity);
    if (cur) writeCreateContentHandleForRun(localStorage, uid, identity, next(cur));
    refreshSavedRun(uid);
  };

  const restoreInputs = (h: CreateContentHandle) => {
    setSeedInsight(h.inputs.seedInsight);
    setSeedCategory(h.inputs.seedCategory);
    setSelectedFormat(h.inputs.formatId ?? NONE);
    setSelectedNature(h.inputs.natureId ?? NONE);
    setSelectedJob(h.inputs.strategyJobId ?? NONE);
    setSelectedInsightCards(h.inputs.insightCardIds);
  };

  // Generate content directions. A BOUND run (resumeJobId) only polls the
  // stored job (invokeQueued skips the invoke) - it never re-admits. A
  // PENDING run (requestKey) re-invokes with the SAME key + snapshot inputs:
  // the server either returns the already-admitted job (stable id on 200/202)
  // or admits it then.
  const runDirections = async (
    uid: string,
    inputs: CreateContentInputs,
    run: { requestKey?: string; resumeJobId?: string },
  ) => {
    if (runInFlightRef.current) return;
    runInFlightRef.current = true;
    setLoading(true);
    // Identity for conditional writes: the requestKey when known (v2), else
    // the bound generationJobId (legacy v1). Never "" - identity-less writes
    // would defeat the multi-tab guard.
    const identity = run.requestKey ?? run.resumeJobId ?? "";
    progressToastRef.current = toast.info(run.resumeJobId ? "Resuming your previous directions run..." : "Generating content directions...");
    try {
      const { data, error } = await invokeQueued(DIRECTIONS_FN, {
        ...invokeInputFields(inputs),
        userId: uid,
        ...(!run.resumeJobId && run.requestKey ? { requestKey: run.requestKey } : {}),
      }, {
        resumeJobId: run.resumeJobId,
        onJobId: (generationJobId) => updateRun(uid, identity, (cur) => bindGenerationJob(cur, generationJobId)),
      });

      if (error || !data) {
        const status = Number((error as { context?: { status?: unknown } } | null)?.context?.status);
        const errBody = await readInvokeErrorBody(error);
        // 409 INPUT_MISMATCH: this requestKey was admitted elsewhere with
        // different settings. Retain the handle + inputs; the user chooses.
        const mismatch = parseInputMismatch(status, errBody);
        if (mismatch) {
          const cur = readRunHandle(localStorage, uid, identity);
          if (cur) setInputMismatch({ handle: cur, existingGenerationJobId: mismatch.existingGenerationJobId });
          return;
        }
        // 409 failed-replay: this requestKey replayed to an existing job that
        // FAILED. Terminal: bind the failed job's identity, mark, retain the
        // inputs. No auto retry, no polling the dead job, no mount zombie -
        // only a deliberate Generate click (fresh requestKey) starts over.
        const failedReplay = parseFailedReplay(status, errBody);
        if (failedReplay) {
          // errBody.error here is the machine code JOB_FAILED, not user text:
          // prefer a human message field, else the fixed fallback.
          const reason = (typeof errBody?.message === "string" && errBody.message) || "The previous generation run failed.";
          updateRun(uid, identity, (cur) => {
            const bound = failedReplay.failedGenerationJobId ? bindGenerationJob(cur, failedReplay.failedGenerationJobId) : cur;
            return markHandleTerminal(bound, reason);
          });
          toast.error(reason + " Your inputs are still here - generate again when ready.");
          return;
        }
        if (run.resumeJobId) {
          // Bound phase: the job itself answered. Transient (status service,
          // expired auth, poll budget) keeps the handle; terminal (404 /
          // failed / unreadable) marks it and retains the inputs.
          if (classifyCreateContentError(error) === "transient") {
            toast.message(invokeErrorMessage(error, errBody, "The job status could not be read."), { description: "Your run is kept. Reopen this page or use Resume to continue it without generating twice." });
            return;
          }
          const reason = invokeErrorMessage(error, errBody, "That run could not be continued.");
          updateRun(uid, identity, (cur) => markHandleTerminal(cur, reason));
          toast.error(reason + " Your inputs are still here - generate again when ready.");
          return;
        }
        // Admission phase: only a 400 validation on a FRESH click clears;
        // everything else keeps the pending key so the run reattaches later
        // (another tab may have admitted it after a racy lookup miss).
        if (classifyAdmissionError(error, { reattach: !run.resumeJobId && !!run.requestKey }) === "clear") {
          clearRun(uid, identity);
          toast.error("Failed to generate directions: " + invokeErrorMessage(error, errBody, "Unknown error"));
          return;
        }
        toast.message(invokeErrorMessage(error, errBody, "The request did not complete."), { description: "Your run is kept. Reopen this page or use Resume to continue it without generating twice." });
        return;
      }

      clearRun(uid, identity); // result consumed (rendered completion)
      setDirections(data.directions || []);
      setStep("directions");

      // Load insight cards when directions are ready
      await loadInsightCards();

      toast.success("Directions generated!");
    } finally {
      clearProgressToast();
      setLoading(false);
      runInFlightRef.current = false;
    }
  };

  const handleGenerateDirections = async () => {
    if (!seedInsight.trim()) {
      toast.error("Please enter your insight");
      return;
    }
    const { data: { session } } = await supabase.auth.getSession();
    const uid = session?.user?.id;
    if (!uid) {
      navigate("/auth");
      return;
    }
    // Never stack a second generation on top of an in-flight one: the same
    // request reattaches to its run, anything else waits for Resume/Discard.
    // A terminal handle does not block - the click below mints a fresh key.
    const active = listCreateContentHandles(localStorage, uid).filter((r) => !isTerminalHandle(r));
    if (active.length) {
      const match = active.find((r) => r.phase === "directions" && sameInputs(r.inputs, currentInputs()));
      setSavedRun(match ?? active[0]);
      if (match) {
        await runDirections(uid, match.inputs, { requestKey: match.requestKey, resumeJobId: match.generationJobId });
        return;
      }
      toast.message("A previous run is still in progress", { description: "Resume it or discard it before starting a new one." });
      return;
    }
    // Deliberate new intent: mint the requestKey and persist the pending
    // handle BEFORE invoking, so the run reattaches even if the browser dies
    // between admission and the answer.
    const inputs = currentInputs();
    const requestKey = mintRequestKey();
    persistRun(uid, buildPendingHandle(uid, "directions", requestKey, inputs));
    await runDirections(uid, inputs, { requestKey });
  };

  // Consume a completed final run through consume-final-job (contract G4):
  // the body is { jobId } only - content and metadata are derived server-side
  // from the stored job, and the generation_job_id guard + unique index make
  // the insert itself idempotent. The notification fires ONLY on created:true;
  // an already-consumed job (created:false) reattaches silently. A "pending"
  // answer (queued/claimed/completing AND paused_auth/paused_quota) means try
  // later, never terminal: poll the job to completion and consume once more.
  const consumeFinal = async (uid: string, generationJobId: string, identity: string, roundsLeft = 3): Promise<void> => {
    const { data, error } = await supabase.functions.invoke(CONSUME_FN, { body: { jobId: generationJobId } });
    const status = error ? Number((error as { context?: { status?: unknown } } | null)?.context?.status) || 0 : 200;
    const outcome = interpretConsumeResult(status, error ? await readInvokeErrorBody(error) : data);

    if (outcome.kind === "pending") {
      if (roundsLeft <= 1) {
        toast.message("Still running - check back in a few minutes.", { description: "Your run is kept. Reopen this page or use Resume to finish it." });
        return;
      }
      const repoll = await invokeQueued(FINAL_FN, {}, { resumeJobId: generationJobId });
      if (repoll.error) {
        if (classifyCreateContentError(repoll.error) === "transient") {
          toast.message(repoll.error.message, { description: "Your run is kept. Reopen this page or use Resume to finish it without generating twice." });
          return;
        }
        updateRun(uid, identity, (cur) => markHandleTerminal(cur, repoll.error.message));
        toast.error(repoll.error.message + " Your inputs are still here - choose a direction again when ready.");
        return;
      }
      return consumeFinal(uid, generationJobId, identity, roundsLeft - 1);
    }

    if (outcome.kind === "transient") {
      // The consume call itself failed (401/429/5xx/network): the completed
      // result stays reattachable server-side - keep the handle, retry later.
      toast.message(outcome.reason, { description: "Your generated content is kept. Reopen this page or use Resume to finish it." });
      return;
    }

    if (outcome.kind === "terminal") {
      // 404 / 409 failed / 422: no placeholder draft, no notification, no
      // navigation. The handle turns terminal and keeps the inputs.
      updateRun(uid, identity, (cur) => markHandleTerminal(cur, outcome.reason));
      toast.error(outcome.reason + " Your inputs are still here - generate again when ready.");
      return;
    }

    clearRun(uid, identity); // fully consumed
    if (outcome.kind === "created") {
      // The persisted draft_ready notification row is owned SOLELY by
      // consume-final-job (contract amendment): calling the local
      // sendDraftNotification hook here would insert a SECOND row. The UI
      // only toasts + navigates; email delivery is the backend's claim, not
      // ours.
      toast.success("Enhanced draft created with your insights!");
    } else {
      // created:false: already-consumed reattach - deliberately quiet.
      toast.message("That draft was already created - opening it.");
    }
    navigate("/drafts");
  };

  // Enhanced content generation with insight cards AND strategy library.
  // A BOUND run (resumeJobId) only polls, then consumes the stored result via
  // consume-final-job. A PENDING run (requestKey) re-invokes with the SAME
  // key + snapshot inputs (idempotent reattach). Completion NEVER inserts a
  // draft directly and never falls back to a placeholder draft (contract: no
  // legacy direct-insert fallback).
  const runFinal = async (
    uid: string,
    inputs: CreateContentInputs,
    direction: ContentDirection,
    directionsForPersist: ContentDirection[],
    run: { requestKey?: string; resumeJobId?: string },
  ) => {
    if (runInFlightRef.current) return;
    runInFlightRef.current = true;
    setLoading(true);
    const identity = run.requestKey ?? run.resumeJobId ?? "";
    progressToastRef.current = toast.info(run.resumeJobId ? "Resuming your previous content run..." : "Creating enhanced draft...");

    try {
      let admittedJobId: string | undefined;
      const { data, error } = await invokeQueued(FINAL_FN, {
        direction,
        ...invokeInputFields(inputs),
        insightCardIds: inputs.insightCardIds,
        userId: uid,
        ...(!run.resumeJobId && run.requestKey ? { requestKey: run.requestKey } : {}),
      }, {
        resumeJobId: run.resumeJobId,
        onJobId: (generationJobId) => {
          admittedJobId = generationJobId;
          updateRun(uid, identity, (cur) => bindGenerationJob(cur, generationJobId));
        },
      });

      if (error) {
        const status = Number((error as { context?: { status?: unknown } } | null)?.context?.status);
        const errBody = await readInvokeErrorBody(error);
        const mismatch = parseInputMismatch(status, errBody);
        if (mismatch) {
          const cur = readRunHandle(localStorage, uid, identity);
          if (cur) setInputMismatch({ handle: cur, existingGenerationJobId: mismatch.existingGenerationJobId });
          return;
        }
        // 409 failed-replay (see runDirections): existing job for this
        // requestKey FAILED - terminal, inputs retained, no auto retry.
        const failedReplay = parseFailedReplay(status, errBody);
        if (failedReplay) {
          const reason = (typeof errBody?.message === "string" && errBody.message) || "The previous generation run failed.";
          updateRun(uid, identity, (cur) => {
            const bound = failedReplay.failedGenerationJobId ? bindGenerationJob(cur, failedReplay.failedGenerationJobId) : cur;
            return markHandleTerminal(bound, reason);
          });
          toast.error(reason + " Your inputs are still here - choose a direction again when ready.");
          return;
        }
        if (run.resumeJobId) {
          // Bound phase: no placeholder is ever substituted for the requested
          // generated content - transient keeps the handle, terminal surfaces
          // the failure and retains the restored inputs and directions list.
          const action = finalRunErrorAction(error);
          if (action.kind === "keep-handle") {
            toast.message(invokeErrorMessage(error, errBody, "The job status could not be read."), { description: "Your run is kept. Reopen this page or use Resume to continue it without generating twice." });
            return;
          }
          const reason = invokeErrorMessage(error, errBody, "That run could not be continued.");
          updateRun(uid, identity, (cur) => markHandleTerminal(cur, reason));
          toast.error(reason + " Your inputs are still here - choose a direction again when ready.");
          return;
        }
        // Admission phase (fresh click or pending reattach).
        if (classifyAdmissionError(error, { reattach: !run.resumeJobId && !!run.requestKey }) === "clear") {
          clearRun(uid, identity);
          toast.error("Failed to start content generation: " + invokeErrorMessage(error, errBody, "Unknown error"));
          return;
        }
        toast.message(invokeErrorMessage(error, errBody, "The request did not complete."), { description: "Your run is kept. Reopen this page or use Resume to continue it without generating twice." });
        return;
      }

      // Completed. A 200 inline answer carries the same admitted jobId as a
      // 202 (stable identity, contract G4); bind before consuming.
      const generationJobId = run.resumeJobId ?? admittedJobId
        ?? (typeof (data as { jobId?: unknown } | null)?.jobId === "string" ? (data as { jobId: string }).jobId : undefined);
      if (!generationJobId) {
        // The result arrived without its job identity (pre-v4 backend): the
        // pending key still reattaches later - never insert a draft directly.
        toast.message("The run completed but its job handle was not returned.", { description: "Your run is kept. Reopen this page or use Resume to finish it." });
        return;
      }
      updateRun(uid, identity, (cur) => (cur.generationJobId === generationJobId ? cur : bindGenerationJob(cur, generationJobId)));
      await consumeFinal(uid, generationJobId, identity);
    } catch (error) {
      console.error("Failed to create enhanced draft:", error);
      toast.error("Failed to create draft: " + (error as { message?: string })?.message);
    } finally {
      clearProgressToast();
      setLoading(false);
      runInFlightRef.current = false;
    }
  };

  const handleGenerateWithInsights = async (direction: ContentDirection) => {
    const { data: { session } } = await supabase.auth.getSession();
    const uid = session?.user?.id;
    if (!uid) {
      navigate("/auth");
      return;
    }
    // A click on the direction whose run is already in flight reattaches to
    // that run instead of starting a duplicate generation. A terminal handle
    // does not block - the click below mints a fresh key.
    const active = listCreateContentHandles(localStorage, uid).filter((r) => !isTerminalHandle(r));
    if (active.length) {
      const match = active.find((r) => r.phase === "final" && sameDirection(r.direction, direction));
      setSavedRun(match ?? active[0]);
      if (match) {
        await runFinal(uid, match.inputs, match.direction as ContentDirection, match.directions ?? [], { requestKey: match.requestKey, resumeJobId: match.generationJobId });
        return;
      }
      toast.message("A previous run is still in progress", { description: "Resume it or discard it before starting a new one." });
      return;
    }
    const inputs = currentInputs();
    const requestKey = mintRequestKey();
    persistRun(uid, buildPendingHandle(uid, "final", requestKey, inputs, { direction, directions }));
    await runFinal(uid, inputs, direction, directions, { requestKey });
  };

  // Reattach to the persisted run: restore its inputs, then poll a BOUND job
  // or replay a PENDING key. A terminal run only restores - it is never
  // re-admitted (contract G2: no silent worker spend).
  const handleResumeSavedRun = async () => {
    const h = savedRun;
    if (!h) return;
    restoreInputs(h);
    if (h.phase === "final" && h.directions?.length) {
      setDirections(h.directions);
      setStep("directions");
    }
    const action = reconcileAction(h);
    if (action === "none") return; // terminal: inputs restored, nothing re-admitted
    if (h.phase === "directions") {
      await runDirections(h.uid, h.inputs, { requestKey: h.requestKey, resumeJobId: h.generationJobId });
    } else if (h.direction) {
      await runFinal(h.uid, h.inputs, h.direction, h.directions ?? [], { requestKey: h.requestKey, resumeJobId: h.generationJobId });
    } else {
      clearRun(h.uid, runIdentityOf(h)); // unresumable shape
    }
  };

  const discardSavedRun = () => {
    if (savedRun) clearRun(savedRun.uid, runIdentityOf(savedRun)); // clears ONLY this run's own slot
    toast.message("In-progress run discarded", { description: "The worker may still finish it, but it will not be picked up here." });
  };

  // Switch the selected saved run. A deliberate selection of an ACTIVE run IS
  // the resume click: restore its inputs and drive it. A terminal run only
  // restores - it is never re-admitted (no silent new generation).
  const selectSavedRun = (identity: string) => {
    const uid = uidRef.current;
    if (!uid) return;
    const h = readRunHandle(localStorage, uid, identity);
    if (!h) {
      refreshSavedRun(uid);
      return;
    }
    setSavedRun(h);
    restoreInputs(h);
    if (h.phase === "final" && h.directions?.length) {
      setDirections(h.directions);
      setStep("directions");
    }
    if (reconcileAction(h) === "none") return;
    if (h.phase === "directions") {
      void runDirections(h.uid, h.inputs, { requestKey: h.requestKey, resumeJobId: h.generationJobId });
    } else if (h.direction) {
      void runFinal(h.uid, h.inputs, h.direction, h.directions ?? [], { requestKey: h.requestKey, resumeJobId: h.generationJobId });
    }
  };

  // 409 INPUT_MISMATCH resolution (contract G3): the old job is never dropped
  // and its content never silently reused - both choices are deliberate.
  const resolveMismatchAdopt = async () => {
    const m = inputMismatch;
    if (!m) return;
    setInputMismatch(null);
    // The stored handle may have been replaced by a NEWER run since the
    // conflict appeared; adopt/discard only ever touch THIS run's handle.
    if (readRunHandle(localStorage, m.handle.uid, runIdentityOf(m.handle))?.requestKey !== m.handle.requestKey) {
      refreshSavedRun(m.handle.uid);
      return;
    }
    if (!m.existingGenerationJobId) {
      // No adoptable identity: keep the restored inputs, drop the local key.
      clearRun(m.handle.uid, runIdentityOf(m.handle));
      return;
    }
    const adopted = bindGenerationJob(m.handle, m.existingGenerationJobId);
    persistRun(m.handle.uid, adopted);
    if (adopted.phase === "directions") {
      await runDirections(adopted.uid, adopted.inputs, { resumeJobId: adopted.generationJobId });
    } else if (adopted.direction) {
      await runFinal(adopted.uid, adopted.inputs, adopted.direction, adopted.directions ?? [], { resumeJobId: adopted.generationJobId });
    }
  };

  const resolveMismatchDiscard = () => {
    if (!inputMismatch) return;
    // Deliberate new intent: drop the local requestKey. The server-side job
    // is left untouched; the next Generate click mints a fresh key.
    clearRun(inputMismatch.handle.uid, runIdentityOf(inputMismatch.handle));
    setInputMismatch(null);
    toast.message("Previous run discarded", { description: "Your inputs are still here - generate again when ready." });
  };

  // On mount, pick up a run that was in flight when the page was last left:
  // restore its inputs (nothing is retyped even if the job turns out to be
  // gone) and resume polling its stored job handle.
  useEffect(() => {
    const recover = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const uid = session?.user?.id;
      if (!uid) return;
      uidRef.current = uid;
      const runs = listCreateContentHandles(localStorage, uid);
      if (!runs.length) return;
      setSavedRuns(runs);
      const h = runs[0]; // newest first; the rest stay selectable below
      setSavedRun(h);
      restoreInputs(h);
      if (h.phase === "final" && h.directions?.length) {
        setDirections(h.directions);
        setStep("directions");
      }
      const action = reconcileAction(h);
      if (action === "none") return; // terminal: restore inputs + explain only, never re-admit
      if (h.phase === "directions") {
        await runDirections(uid, h.inputs, { requestKey: h.requestKey, resumeJobId: h.generationJobId });
      } else if (h.direction) {
        await runFinal(uid, h.inputs, h.direction, h.directions ?? [], { requestKey: h.requestKey, resumeJobId: h.generationJobId });
      }
    };
    recover();
    // Mount-once recovery: resumes only the run persisted before this page load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // NEW FUNCTION: Load user's insight cards
  const loadInsightCards = async () => {
    const { data: { session } } = await supabase.auth.getSession();

    const { data, error } = await supabase
      .from("insight_cards")
      .select("id, title, content, insight_type")
      .eq("user_id", session?.user?.id)
      .eq("status", "active")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Error loading insight cards:", error);
      // If table doesn't exist yet, fail gracefully
      if (error.code === '42P01') {
        console.log("Insight cards table not created yet - this is expected during initial deployment");
        setInsightCards([]);
        return;
      }
      toast.error("Failed to load insight cards");
    } else {
      setInsightCards(data || []);
    }
  };

  const toggleInsightCard = (insightId: string) => {
    setSelectedInsightCards(prev =>
      prev.includes(insightId)
        ? prev.filter(id => id !== insightId)
        : [...prev, insightId]
    );
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="container mx-auto px-4 py-4">
          <Button variant="ghost" onClick={() => navigate("/dashboard")}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Dashboard
          </Button>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 max-w-3xl">
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">Create Content</h1>
          <p className="text-muted-foreground">Start with your seed insight</p>
        </div>

        {savedRuns.length > 1 && (
          <Card className="mb-6">
            <CardContent className="p-4 flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
              <p className="text-sm">
                {savedRuns.length} runs are saved on this device. The newest is shown - pick another to switch to it.
              </p>
              <select
                aria-label="Saved runs"
                className="h-9 rounded-md border bg-background px-3 text-sm shrink-0"
                value={savedRun ? runIdentityOf(savedRun) : ""}
                onChange={(e) => selectSavedRun(e.target.value)}
              >
                {savedRuns.map((r) => (
                  <option key={runIdentityOf(r)} value={runIdentityOf(r)}>
                    {(r.phase === "final" ? "Draft" : "Directions") +
                      " - " +
                      (isTerminalHandle(r) ? "failed" : "in progress") +
                      " - " +
                      new Date(r.updatedAt).toLocaleString()}
                  </option>
                ))}
              </select>
            </CardContent>
          </Card>
        )}

        {savedRun && isTerminalHandle(savedRun) && (
          <Card className="mb-6 border-destructive">
            <CardContent className="p-4 flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
              <p className="text-sm">
                That {savedRun.phase === "final" ? "draft" : "directions"} run could not be completed
                {savedRun.terminalReason ? ": " + savedRun.terminalReason : "."}{" "}
                Your inputs are restored below - adjust anything and generate again when ready.
              </p>
              <div className="flex gap-2 shrink-0">
                <Button variant="outline" onClick={() => clearRun(savedRun.uid, runIdentityOf(savedRun))} disabled={loading}>
                  Dismiss
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {inputMismatch && (
          <Card className="mb-6 border-primary">
            <CardContent className="p-4 flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
              <p className="text-sm">
                A run with different settings is already in progress for this action.
                Resume the existing run, or start over - the existing run is never replaced silently.
              </p>
              <div className="flex gap-2 shrink-0">
                <Button onClick={resolveMismatchAdopt} disabled={loading}>
                  <Sparkles className="mr-2 h-4 w-4" />
                  Resume existing run
                </Button>
                <Button variant="outline" onClick={resolveMismatchDiscard} disabled={loading}>
                  Start over
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {savedRun && !isTerminalHandle(savedRun) && !inputMismatch && (
          <Card className="mb-6 border-primary">
            <CardContent className="p-4 flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
              <p className="text-sm">
                A previous {savedRun.phase === "final" ? "draft" : "directions"} run is still in progress.
                Resume it to pick up where you left off, or discard it to start over.
              </p>
              <div className="flex gap-2 shrink-0">
                <Button onClick={handleResumeSavedRun} disabled={loading}>
                  <Sparkles className="mr-2 h-4 w-4" />
                  Resume
                </Button>
                <Button variant="outline" onClick={discardSavedRun} disabled={loading}>
                  Discard
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {step === "input" && (
          <Card>
            <CardHeader>
              <CardTitle>Seed Insight</CardTitle>
              <CardDescription>What's the core idea you want to explore?</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label htmlFor="insight">Your Insight</Label>
                <Textarea
                  id="insight"
                  value={seedInsight}
                  onChange={(e) => setSeedInsight(e.target.value)}
                  placeholder="Enter your core idea, observation, or thesis..."
                  rows={6}
                  className="mt-2"
                />
              </div>

              <div>
                <Label htmlFor="category">Insight Type</Label>
                <Select value={seedCategory} onValueChange={setSeedCategory}>
                  <SelectTrigger id="category" className="mt-2">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="thesis">Thesis Statement</SelectItem>
                    <SelectItem value="hook">Hook / Attention Grabber</SelectItem>
                    <SelectItem value="closing">Closing Statement</SelectItem>
                    <SelectItem value="contrarian">Contrarian Argument</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Strategy library: optional format/nature/job so this can align with
                  the same tables the Schedule autopilot reads. All optional -
                  leave any of them unset and the writer decides. */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <Label htmlFor="format" className="text-xs">Format</Label>
                  <Select value={selectedFormat} onValueChange={setSelectedFormat}>
                    <SelectTrigger id="format" className="mt-2"><SelectValue placeholder="Unset" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>Unset</SelectItem>
                      {formats.map((f) => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="nature" className="text-xs">Nature</Label>
                  <Select value={selectedNature} onValueChange={setSelectedNature}>
                    <SelectTrigger id="nature" className="mt-2"><SelectValue placeholder="Unset" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>Unset</SelectItem>
                      {natures.map((n) => <SelectItem key={n.id} value={n.id}>{n.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="job" className="text-xs">Job</Label>
                  <Select value={selectedJob} onValueChange={setSelectedJob}>
                    <SelectTrigger id="job" className="mt-2"><SelectValue placeholder="Unset" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>Unset</SelectItem>
                      {jobs.map((j) => <SelectItem key={j.id} value={j.id}>{j.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <Button onClick={handleGenerateDirections} disabled={loading} className="w-full" size="lg">
                <Sparkles className="mr-2 h-5 w-5" />
                {loading ? "Generating..." : "Generate Content Directions"}
              </Button>
            </CardContent>
          </Card>
        )}

        {step === "directions" && (
          <Card>
            <CardHeader>
              <div className="flex justify-between items-center">
                <div>
                  <CardTitle>Content Directions</CardTitle>
                  <CardDescription>
                    Select the direction that resonates most
                    {insightCards.length > 0 && (
                      <span className="ml-2 text-sm">
                        • {selectedInsightCards.length} insights selected
                      </span>
                    )}
                    {selectedFormat !== NONE && (
                      <span className="ml-2 text-sm">
                        • Format: {formats.find(f => f.id === selectedFormat)?.name}
                      </span>
                    )}
                  </CardDescription>
                </div>
                <div className="flex gap-2">
                  {insightCards.length > 0 && (
                    <Button
                      variant="outline"
                      onClick={() => setShowInsightSelection(!showInsightSelection)}
                    >
                      <Lightbulb className="mr-2 h-4 w-4" />
                      {showInsightSelection ? "Hide Insights" : "Add Insights"}
                    </Button>
                  )}
                  <Button variant="outline" onClick={() => setStep("input")}>
                    Back
                  </Button>
                </div>
              </div>
            </CardHeader>

            <CardContent className="space-y-6">
              {/* NEW: Insight Card Selection Section */}
              {showInsightSelection && insightCards.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">Select Insight Cards</CardTitle>
                    <CardDescription>
                      Choose relevant insights to enhance your content
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3 max-h-60 overflow-y-auto">
                    {insightCards.map((insight) => (
                      <div key={insight.id} className="flex items-start space-x-3 p-3 border rounded-lg">
                        <Checkbox
                          checked={selectedInsightCards.includes(insight.id)}
                          onCheckedChange={() => toggleInsightCard(insight.id)}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-sm font-medium">{insight.title}</span>
                            <span className="text-xs bg-secondary text-secondary-foreground px-2 py-1 rounded">
                              {insight.insight_type}
                            </span>
                          </div>
                          <p className="text-sm text-muted-foreground line-clamp-2">
                            {insight.content}
                          </p>
                        </div>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}

              {/* Original Directions List - Enhanced */}
              <div className="space-y-4">
                {directions.map((dir, i) => (
                  <Card
                    key={i}
                    className="cursor-pointer hover:border-primary transition-colors"
                    onClick={() => handleGenerateWithInsights(dir)}
                  >
                    <CardContent className="p-4">
                      <div className="flex justify-between items-start">
                        <div className="flex-1">
                          <h3 className="font-semibold mb-2">{dir.title}</h3>
                          <p className="text-sm text-muted-foreground mb-2">{dir.description}</p>
                          <p className="text-xs text-muted-foreground italic">Angle: {dir.angle}</p>
                        </div>
                        <div className="flex flex-col items-end gap-2">
                          {selectedInsightCards.length > 0 && (
                            <div className="flex items-center gap-1 text-xs text-primary bg-primary/10 px-2 py-1 rounded">
                              <Lightbulb className="h-3 w-3" />
                              +{selectedInsightCards.length} insights
                            </div>
                          )}
                          {selectedFormat !== NONE && (
                            <div className="flex items-center gap-1 text-xs text-blue-600 bg-blue-50 px-2 py-1 rounded">
                              <FileText className="h-3 w-3" />
                              {formats.find(f => f.id === selectedFormat)?.name}
                            </div>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
};

export default CreateContent;
