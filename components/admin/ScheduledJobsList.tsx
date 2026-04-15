"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { JOB_DEFINITIONS } from "@/lib/cron/job-definitions";

interface RunRecord {
  id: string;
  job_key: string;
  started_at: string;
  finished_at: string | null;
  status: string;
  result: Record<string, unknown> | null;
  triggered_by: string;
}

interface EmailSetting {
  key: string;
  enabled: boolean;
}

interface ScheduledJobsListProps {
  runs: RunRecord[];
  emailSettings: EmailSetting[];
}

export default function ScheduledJobsList({
  runs,
  emailSettings,
}: ScheduledJobsListProps) {
  const router = useRouter();
  const [runningJob, setRunningJob] = useState<string | null>(null);
  const [runResults, setRunResults] = useState<
    Record<string, { status: "success" | "error"; data: Record<string, unknown> }>
  >({});
  const [expandedJob, setExpandedJob] = useState<string | null>(null);

  const settingsMap = Object.fromEntries(
    emailSettings.map((s) => [s.key, s.enabled])
  );

  // Group runs by job_key
  const runsByJob: Record<string, RunRecord[]> = {};
  for (const run of runs) {
    if (!runsByJob[run.job_key]) runsByJob[run.job_key] = [];
    runsByJob[run.job_key].push(run);
  }

  async function handleRunNow(jobKey: string) {
    if (
      !confirm(
        `Run "${JOB_DEFINITIONS[jobKey]?.name}" now? This will execute the job immediately in production.`
      )
    ) {
      return;
    }

    setRunningJob(jobKey);
    setRunResults((prev) => {
      const next = { ...prev };
      delete next[jobKey];
      return next;
    });

    try {
      const res = await fetch("/api/admin/scheduled-jobs/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ job_key: jobKey }),
      });

      const data = await res.json();

      if (!res.ok) {
        setRunResults((prev) => ({
          ...prev,
          [jobKey]: { status: "error", data },
        }));
      } else {
        setRunResults((prev) => ({
          ...prev,
          [jobKey]: { status: "success", data },
        }));
      }

      router.refresh();
    } catch {
      setRunResults((prev) => ({
        ...prev,
        [jobKey]: { status: "error", data: { error: "Network error" } },
      }));
    } finally {
      setRunningJob(null);
    }
  }

  function formatTimestamp(iso: string | null) {
    if (!iso) return "—";
    return new Date(iso).toLocaleString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  }

  function formatResult(result: Record<string, unknown> | null) {
    if (!result) return "—";
    if (result.error) return String(result.error);
    const parts: string[] = [];
    for (const [key, val] of Object.entries(result)) {
      if (typeof val === "number") parts.push(`${val} ${key}`);
    }
    return parts.length > 0 ? parts.join(", ") : JSON.stringify(result);
  }

  function getJobStatus(jobKey: string): { label: string; color: string } {
    const def = JOB_DEFINITIONS[jobKey];
    if (!def?.emailSettingsKey) {
      return { label: "Always on", color: "bg-blue-100 text-blue-800" };
    }
    const enabled = settingsMap[def.emailSettingsKey];
    if (enabled === undefined || enabled) {
      return { label: "Active", color: "bg-green-100 text-green-800" };
    }
    return { label: "Paused", color: "bg-gray-100 text-gray-500" };
  }

  const jobKeys = Object.keys(JOB_DEFINITIONS);

  return (
    <div className="space-y-4">
      {jobKeys.map((jobKey) => {
        const def = JOB_DEFINITIONS[jobKey];
        const jobRuns = runsByJob[jobKey] || [];
        const lastRun = jobRuns[0] || null;
        const status = getJobStatus(jobKey);
        const isExpanded = expandedJob === jobKey;
        const isRunning = runningJob === jobKey;
        const result = runResults[jobKey];

        return (
          <div
            key={jobKey}
            className="bg-white rounded-xl border border-border p-6"
          >
            {/* Header */}
            <div className="flex items-start justify-between gap-4 mb-4">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="font-body font-semibold text-marine">
                    {def.name}
                  </h3>
                  <span
                    className={`inline-block px-2 py-0.5 rounded-full text-xs font-body ${status.color}`}
                  >
                    {status.label}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground font-body">
                  {def.description}
                </p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-xs text-muted-foreground font-body uppercase tracking-wide mb-0.5">
                  Schedule
                </p>
                <p className="text-sm font-body text-marine font-medium">
                  {def.scheduleLabel}
                </p>
              </div>
            </div>

            {/* Stats row */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
              <div>
                <p className="text-xs text-muted-foreground font-body uppercase tracking-wide mb-0.5">
                  Last Run
                </p>
                <p className="text-sm font-body text-marine">
                  {lastRun ? formatTimestamp(lastRun.started_at) : "Never"}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground font-body uppercase tracking-wide mb-0.5">
                  Last Status
                </p>
                {lastRun ? (
                  <span
                    className={`inline-block px-2 py-0.5 rounded-full text-xs font-body ${
                      lastRun.status === "success"
                        ? "bg-green-100 text-green-800"
                        : "bg-red-100 text-red-800"
                    }`}
                  >
                    {lastRun.status}
                  </span>
                ) : (
                  <p className="text-sm font-body text-marine">—</p>
                )}
              </div>
              <div>
                <p className="text-xs text-muted-foreground font-body uppercase tracking-wide mb-0.5">
                  Last Result
                </p>
                <p className="text-sm font-body text-marine">
                  {lastRun ? formatResult(lastRun.result as Record<string, unknown> | null) : "—"}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground font-body uppercase tracking-wide mb-0.5">
                  Triggered By
                </p>
                <p className="text-sm font-body text-marine capitalize">
                  {lastRun?.triggered_by ?? "—"}
                </p>
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-3">
              <button
                onClick={() => handleRunNow(jobKey)}
                disabled={isRunning}
                className="px-4 py-2 bg-white border border-border text-marine rounded-lg text-sm font-body font-medium hover:bg-cream transition-colors disabled:opacity-50"
              >
                {isRunning ? "Running..." : "Run Now"}
              </button>

              {jobRuns.length > 0 && (
                <button
                  onClick={() =>
                    setExpandedJob(isExpanded ? null : jobKey)
                  }
                  className="px-4 py-2 text-sm font-body text-muted-foreground hover:text-marine transition-colors"
                >
                  {isExpanded
                    ? "Hide history"
                    : `View history (${jobRuns.length})`}
                </button>
              )}

              {result && (
                <span
                  className={`text-sm font-body ${
                    result.status === "success"
                      ? "text-green-700"
                      : "text-red-600"
                  }`}
                >
                  {result.status === "error"
                    ? `Error: ${String(result.data.error ?? "Unknown error")}`
                    : `Done: ${formatResult(result.data)}`}
                </span>
              )}
            </div>

            {/* Expandable log view */}
            {isExpanded && jobRuns.length > 0 && (
              <div className="mt-4 border-t border-border pt-4">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="px-3 py-2 text-left text-xs font-body uppercase tracking-wide text-muted-foreground">
                        Started
                      </th>
                      <th className="px-3 py-2 text-left text-xs font-body uppercase tracking-wide text-muted-foreground">
                        Duration
                      </th>
                      <th className="px-3 py-2 text-left text-xs font-body uppercase tracking-wide text-muted-foreground">
                        Status
                      </th>
                      <th className="px-3 py-2 text-left text-xs font-body uppercase tracking-wide text-muted-foreground">
                        Result
                      </th>
                      <th className="px-3 py-2 text-left text-xs font-body uppercase tracking-wide text-muted-foreground">
                        Trigger
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {jobRuns.map((run) => {
                      const durationMs =
                        run.finished_at && run.started_at
                          ? new Date(run.finished_at).getTime() -
                            new Date(run.started_at).getTime()
                          : null;

                      return (
                        <tr
                          key={run.id}
                          className="hover:bg-cream/50 transition-colors"
                        >
                          <td className="px-3 py-2 font-body text-marine">
                            {formatTimestamp(run.started_at)}
                          </td>
                          <td className="px-3 py-2 font-body text-muted-foreground">
                            {durationMs !== null
                              ? durationMs < 1000
                                ? `${durationMs}ms`
                                : `${(durationMs / 1000).toFixed(1)}s`
                              : "—"}
                          </td>
                          <td className="px-3 py-2">
                            <span
                              className={`inline-block px-2 py-0.5 rounded-full text-xs font-body ${
                                run.status === "success"
                                  ? "bg-green-100 text-green-800"
                                  : "bg-red-100 text-red-800"
                              }`}
                            >
                              {run.status}
                            </span>
                          </td>
                          <td className="px-3 py-2 font-body text-muted-foreground text-xs max-w-xs truncate">
                            {formatResult(run.result as Record<string, unknown> | null)}
                          </td>
                          <td className="px-3 py-2 font-body text-muted-foreground capitalize">
                            {run.triggered_by}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
