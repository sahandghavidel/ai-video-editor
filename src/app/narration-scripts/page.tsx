'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Pause,
  Play,
  RefreshCw,
  Square,
  Trash2,
} from 'lucide-react';

type NarrationScript = {
  id: number;
  title: string;
  outline: string;
  status: string | null;
  date: string | null;
  lastEdited: string | null;
  sceneCount: number;
};

type NarrationScriptScene = {
  id: number;
  sceneNumber: number;
  part: string | null;
  scriptIds: number[];
  narration: string;
  onScreen: string;
  annotation: string;
  code: string;
  language: string;
  targetFile: string;
  codeInstruction: string;
  lastEdited: string | null;
};

type SpeechState = 'idle' | 'speaking' | 'paused';
type TtsAction = 'speak' | 'pause' | 'resume' | 'stop';
type SceneSaveState = 'idle' | 'saving' | 'saved' | 'error';
type ScriptSaveState = 'idle' | 'saving' | 'saved' | 'error';
type ScriptDraft = Pick<NarrationScript, 'title' | 'status'>;
type SceneDraft = Pick<
  NarrationScriptScene,
  'part' | 'narration' | 'onScreen' | 'annotation' | 'code' | 'language' | 'targetFile' | 'codeInstruction'
>;
type SceneDraftField = keyof SceneDraft;

const scriptStatusOptions = ['Draft', 'In Progress', 'Ready', 'Archived'] as const;

const sceneDraftFields: SceneDraftField[] = [
  'part',
  'narration',
  'onScreen',
  'annotation',
  'code',
  'language',
  'targetFile',
  'codeInstruction',
];

const inputClass = 'rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900';

function sceneToDraft(scene: NarrationScriptScene): SceneDraft {
  return {
    part: scene.part,
    narration: scene.narration,
    onScreen: scene.onScreen,
    annotation: scene.annotation,
    code: scene.code,
    language: scene.language,
    targetFile: scene.targetFile,
    codeInstruction: scene.codeInstruction,
  };
}

function scriptToDraft(script: NarrationScript): ScriptDraft {
  return { title: script.title, status: script.status };
}

function scriptDraftIsDirty(script: NarrationScript, draft: ScriptDraft | undefined) {
  if (!draft) return false;
  return draft.title.trim() !== script.title || (draft.status ?? '') !== (script.status ?? '');
}

function sceneDraftIsDirty(scene: NarrationScriptScene, draft: SceneDraft | undefined) {
  if (!draft) return false;
  return sceneDraftFields.some((field) => (draft[field] ?? '') !== (scene[field] ?? ''));
}

function narrationPreview(text: string) {
  const normalized = text.replace(/\s+/g, ' ').trim();
  return normalized.length > 120 ? `${normalized.slice(0, 117)}…` : normalized;
}

function scriptIdFromUrl() {
  if (typeof window === 'undefined') return null;
  const value = new URLSearchParams(window.location.search).get('script');
  const id = value ? Number(value) : NaN;
  return Number.isInteger(id) && id > 0 ? id : null;
}

function writeScriptIdToUrl(id: number | null) {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  if (id) url.searchParams.set('script', String(id));
  else url.searchParams.delete('script');
  window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
}

function sceneIdFromUrl() {
  if (typeof window === 'undefined') return null;
  const value = new URLSearchParams(window.location.search).get('scene');
  const id = value ? Number(value) : NaN;
  return Number.isInteger(id) && id > 0 ? id : null;
}

function writeSceneIdToUrl(id: number | null) {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  if (id) url.searchParams.set('scene', String(id));
  else url.searchParams.delete('scene');
  window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
}

export default function NarrationScriptsPage() {
  const [scripts, setScripts] = useState<NarrationScript[]>([]);
  const [scenes, setScenes] = useState<NarrationScriptScene[]>([]);
  const [selectedScriptId, setSelectedScriptId] = useState<number | null>(null);
  const [partFilter, setPartFilter] = useState('');
  const [query, setQuery] = useState('');
  const [expandedSceneId, setExpandedSceneId] = useState<number | null>(null);
  const [speakingSceneId, setSpeakingSceneId] = useState<number | null>(null);
  const [speechState, setSpeechState] = useState<SpeechState>('idle');
  const [speechError, setSpeechError] = useState('');
  const [scriptDrafts, setScriptDrafts] = useState<Record<number, ScriptDraft>>({});
  const [editingScriptId, setEditingScriptId] = useState<number | null>(null);
  const [savingScriptId, setSavingScriptId] = useState<number | null>(null);
  const [deletingScriptId, setDeletingScriptId] = useState<number | null>(null);
  const [scriptSaveState, setScriptSaveState] = useState<ScriptSaveState>('idle');
  const [scriptSaveError, setScriptSaveError] = useState('');
  const [sceneDrafts, setSceneDrafts] = useState<Record<number, SceneDraft>>({});
  const [savingSceneId, setSavingSceneId] = useState<number | null>(null);
  const [deletingSceneId, setDeletingSceneId] = useState<number | null>(null);
  const [sceneSaveState, setSceneSaveState] = useState<SceneSaveState>('idle');
  const [sceneSaveError, setSceneSaveError] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const sceneCardRefs = useRef<Record<number, HTMLElement | null>>({});
  const speechStartedAtRef = useRef(0);
  const sceneNavigationInFlightRef = useRef(false);

  const load = useCallback(async (manual = false) => {
    if (manual) setRefreshing(true);
    else setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/narration-scripts', { cache: 'no-store' });
      const payload = (await response.json()) as {
        scripts?: NarrationScript[];
        scenes?: NarrationScriptScene[];
        error?: string;
      };
      if (!response.ok) throw new Error(payload.error || 'Unable to load narration scripts.');
      const nextScripts = payload.scripts || [];
      setScripts(nextScripts);
      setScenes(payload.scenes || []);
      setScriptDrafts({});
      setEditingScriptId(null);
      setScriptSaveState('idle');
      setScriptSaveError('');
      setSceneDrafts({});
      setSceneSaveState('idle');
      setSceneSaveError('');
      const requestedScriptId = scriptIdFromUrl();
      setSelectedScriptId((current) =>
        requestedScriptId && nextScripts.some((script) => script.id === requestedScriptId)
          ? requestedScriptId
          : current && nextScripts.some((script) => script.id === current)
            ? current
            : nextScripts[0]?.id ?? null,
      );
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load narration scripts.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!selectedScriptId || !scenes.length) return;
    const requestedSceneId = sceneIdFromUrl();
    if (!requestedSceneId) return;
    const requestedScene = scenes.find((scene) => scene.id === requestedSceneId);
    if (requestedScene?.scriptIds.includes(selectedScriptId)) {
      setExpandedSceneId(requestedSceneId);
    }
  }, [scenes, selectedScriptId]);

  const selectedScript = scripts.find((script) => script.id === selectedScriptId) || null;
  const parts = useMemo(
    () => Array.from(new Set(scenes.filter((scene) => scene.scriptIds.includes(selectedScriptId || -1)).map((scene) => scene.part).filter(Boolean) as string[])),
    [scenes, selectedScriptId],
  );
  const visibleScenes = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return scenes.filter((scene) => {
      if (!selectedScriptId || !scene.scriptIds.includes(selectedScriptId)) return false;
      if (partFilter && scene.part !== partFilter) return false;
      if (!normalizedQuery) return true;
      return [scene.narration, scene.onScreen, scene.annotation, scene.code, scene.part]
        .join(' ')
        .toLowerCase()
        .includes(normalizedQuery);
    });
  }, [partFilter, query, scenes, selectedScriptId]);

  const dirtySceneIds = useMemo(() => {
    const ids = new Set<number>();
    scenes.forEach((scene) => {
      if (sceneDraftIsDirty(scene, sceneDrafts[scene.id])) ids.add(scene.id);
    });
    return ids;
  }, [sceneDrafts, scenes]);

  const dirtyScriptIds = useMemo(() => {
    const ids = new Set<number>();
    scripts.forEach((script) => {
      if (scriptDraftIsDirty(script, scriptDrafts[script.id])) ids.add(script.id);
    });
    return ids;
  }, [scriptDrafts, scripts]);

  const confirmDiscardUnsavedChanges = useCallback(() => {
    if (dirtySceneIds.size === 0 && dirtyScriptIds.size === 0) return true;
    const shouldDiscard = window.confirm(
      'You have unsaved script or scene changes. Discard them and continue?',
    );
    if (!shouldDiscard) return false;

    setSceneDrafts((current) => {
      const next = { ...current };
      dirtySceneIds.forEach((id) => delete next[id]);
      return next;
    });
    setScriptDrafts((current) => {
      const next = { ...current };
      dirtyScriptIds.forEach((id) => delete next[id]);
      return next;
    });
    setEditingScriptId(null);
    setScriptSaveState('idle');
    setScriptSaveError('');
    setSceneSaveState('idle');
    setSceneSaveError('');
    return true;
  }, [dirtySceneIds, dirtyScriptIds]);

  const sendTtsAction = useCallback(async (action: TtsAction, text?: string) => {
    const response = await fetch('/api/narration-tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, text }),
    });
    const payload = (await response.json()) as { error?: string };
    if (!response.ok) throw new Error(payload.error || 'Narration Pilot TTS failed.');
  }, []);

  const updateScriptDraft = useCallback(
    (script: NarrationScript, field: keyof ScriptDraft, value: string) => {
      setScriptDrafts((current) => ({
        ...current,
        [script.id]: {
          ...(current[script.id] ?? scriptToDraft(script)),
          [field]: value,
        },
      }));
      setScriptSaveState('idle');
      setScriptSaveError('');
    },
    [],
  );

  const beginScriptTitleEdit = useCallback(
    (script: NarrationScript) => {
      if (savingScriptId !== null || deletingScriptId !== null) return;
      if (editingScriptId !== null && editingScriptId !== script.id && !confirmDiscardUnsavedChanges()) return;
      setScriptDrafts((current) => ({
        ...current,
        [script.id]: current[script.id] ?? scriptToDraft(script),
      }));
      setEditingScriptId(script.id);
      setScriptSaveState('idle');
      setScriptSaveError('');
    },
    [confirmDiscardUnsavedChanges, deletingScriptId, editingScriptId, savingScriptId],
  );

  const saveScript = useCallback(
    async (script: NarrationScript) => {
      const draft = scriptDrafts[script.id] ?? scriptToDraft(script);
      const title = draft.title.trim();
      if (!title) {
        setEditingScriptId(script.id);
        setScriptSaveState('error');
        setScriptSaveError('Script title cannot be empty.');
        return;
      }

      setSavingScriptId(script.id);
      setScriptSaveState('saving');
      setScriptSaveError('');
      try {
        const response = await fetch(`/api/narration-scripts/scripts/${script.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title, status: draft.status?.trim() || null }),
        });
        const payload = (await response.json().catch(() => null)) as {
          script?: { id: number; title: string; status: string | null; lastEdited: string | null };
          error?: string;
        } | null;
        if (!response.ok || !payload?.script) {
          throw new Error(payload?.error || 'Could not save this script.');
        }

        setScripts((current) =>
          current.map((item) =>
            item.id === script.id
              ? { ...item, title: payload.script!.title, status: payload.script!.status, lastEdited: payload.script!.lastEdited }
              : item,
          ),
        );
        setScriptDrafts((current) => {
          const next = { ...current };
          delete next[script.id];
          return next;
        });
        setEditingScriptId(null);
        setScriptSaveState('saved');
      } catch (saveError) {
        setScriptSaveState('error');
        setScriptSaveError(saveError instanceof Error ? saveError.message : 'Could not save this script.');
      } finally {
        setSavingScriptId(null);
      }
    },
    [scriptDrafts],
  );

  const cancelScriptEdit = useCallback((scriptId: number) => {
    setScriptDrafts((current) => {
      const next = { ...current };
      delete next[scriptId];
      return next;
    });
    setEditingScriptId(null);
    setScriptSaveState('idle');
    setScriptSaveError('');
  }, []);

  const deleteScript = useCallback(
    async (script: NarrationScript) => {
      const relatedScenes = scenes.filter((scene) => scene.scriptIds.includes(script.id));
      const hasUnsavedChanges = dirtyScriptIds.has(script.id) || relatedScenes.some((scene) => dirtySceneIds.has(scene.id));
      const unsavedWarning = hasUnsavedChanges
        ? '\n\nUnsaved edits for this script or its scenes will also be lost.'
        : '';
      const shouldDelete = window.confirm(
        `Delete “${script.title}” permanently?\n\nThis will also delete ${relatedScenes.length} related scene${relatedScenes.length === 1 ? '' : 's'}.${unsavedWarning}`,
      );
      if (!shouldDelete) return;

      const relatedSceneIds = new Set(relatedScenes.map((scene) => scene.id));
      const deletingSelectedScript = selectedScriptId === script.id;
      const nextScript = deletingSelectedScript
        ? scripts.find((item) => item.id !== script.id) ?? null
        : null;
      setDeletingScriptId(script.id);
      setScriptSaveState('saving');
      setScriptSaveError('');
      try {
        if (speakingSceneId !== null && relatedSceneIds.has(speakingSceneId)) {
          try {
            await sendTtsAction('stop');
          } catch {
            // The cascade should still proceed if the speech bridge is unavailable.
          }
          setSpeakingSceneId(null);
          setSpeechState('idle');
        }

        const response = await fetch(`/api/narration-scripts/scripts/${script.id}`, { method: 'DELETE' });
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        if (!response.ok) throw new Error(payload?.error || 'Could not delete this script.');

        setScripts((current) => current.filter((item) => item.id !== script.id));
        setScenes((current) => current.filter((scene) => !relatedSceneIds.has(scene.id)));
        setScriptDrafts((current) => {
          const next = { ...current };
          delete next[script.id];
          return next;
        });
        setSceneDrafts((current) => {
          const next = { ...current };
          relatedSceneIds.forEach((id) => delete next[id]);
          return next;
        });
        if (deletingSelectedScript) {
          setSelectedScriptId(nextScript?.id ?? null);
          writeScriptIdToUrl(nextScript?.id ?? null);
          setExpandedSceneId(null);
          writeSceneIdToUrl(null);
          setPartFilter('');
          setQuery('');
        }
        setEditingScriptId(null);
        setScriptSaveState('idle');
      } catch (deleteError) {
        setScriptSaveState('error');
        setScriptSaveError(deleteError instanceof Error ? deleteError.message : 'Could not delete this script.');
      } finally {
        setDeletingScriptId(null);
      }
    },
    [dirtySceneIds, dirtyScriptIds, scenes, scripts, selectedScriptId, sendTtsAction, speakingSceneId],
  );

  useEffect(() => {
    if (expandedSceneId && !visibleScenes.some((scene) => scene.id === expandedSceneId)) {
      setExpandedSceneId(null);
      writeSceneIdToUrl(null);
    }
  }, [expandedSceneId, visibleScenes]);

  useEffect(() => {
    if (speakingSceneId === null) return;
    let cancelled = false;

    const pollSpeechState = async () => {
      try {
        const response = await fetch('/api/narration-tts', { cache: 'no-store' });
        const payload = (await response.json()) as {
          available?: boolean;
          state?: SpeechState;
        };
        if (cancelled || !payload.available) return;
        if (payload.state === 'paused') setSpeechState('paused');
        if (payload.state === 'speaking') setSpeechState('speaking');
        if (payload.state === 'idle' && Date.now() - speechStartedAtRef.current > 1500) {
          setSpeakingSceneId(null);
          setSpeechState('idle');
        }
      } catch {
        // The Play action reports connection errors directly; polling is best-effort.
      }
    };

    void pollSpeechState();
    const interval = window.setInterval(() => void pollSpeechState(), 800);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [speakingSceneId]);

  const stopNarration = useCallback(async () => {
    if (speakingSceneId === null) return;
    try {
      await sendTtsAction('stop');
      setSpeakingSceneId(null);
      setSpeechState('idle');
    } catch (ttsError) {
      setSpeechError(ttsError instanceof Error ? ttsError.message : 'Could not stop narration.');
    }
  }, [sendTtsAction, speakingSceneId]);

  const playNarration = useCallback(async (scene: NarrationScriptScene) => {
    setSpeechError('');
    try {
      const narration = sceneDrafts[scene.id]?.narration ?? scene.narration;
      if (speakingSceneId === scene.id && speechState === 'speaking') {
        await sendTtsAction('pause');
        setSpeechState('paused');
        return;
      }
      if (speakingSceneId === scene.id && speechState === 'paused') {
        await sendTtsAction('resume');
        setSpeechState('speaking');
        return;
      }

      if (speakingSceneId !== null) await sendTtsAction('stop');
      await sendTtsAction('speak', narration);
      setExpandedSceneId(scene.id);
      writeSceneIdToUrl(scene.id);
      setSpeakingSceneId(scene.id);
      setSpeechState('speaking');
      speechStartedAtRef.current = Date.now();
    } catch (ttsError) {
      setSpeechError(ttsError instanceof Error ? ttsError.message : 'Could not play narration.');
      setSpeakingSceneId(null);
      setSpeechState('idle');
    }
  }, [sceneDrafts, sendTtsAction, speakingSceneId, speechState]);

  const updateSceneDraft = useCallback(
    (scene: NarrationScriptScene, field: SceneDraftField, value: string) => {
      setSceneDrafts((current) => ({
        ...current,
        [scene.id]: {
          ...(current[scene.id] ?? sceneToDraft(scene)),
          [field]: value,
        },
      }));
      setSceneSaveState('idle');
      setSceneSaveError('');
    },
    [],
  );

  const saveScene = useCallback(
    async (scene: NarrationScriptScene) => {
      const draft = sceneDrafts[scene.id] ?? sceneToDraft(scene);
      setSavingSceneId(scene.id);
      setSceneSaveState('saving');
      setSceneSaveError('');
      try {
        const response = await fetch(`/api/narration-scripts/scenes/${scene.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(draft),
        });
        const payload = (await response.json().catch(() => null)) as {
          scene?: NarrationScriptScene;
          error?: string;
        } | null;
        if (!response.ok || !payload?.scene) {
          throw new Error(payload?.error || 'Could not save this scene.');
        }

        setScenes((current) =>
          current.map((item) => (item.id === scene.id ? payload.scene! : item)),
        );
        setSceneDrafts((current) => ({
          ...current,
          [scene.id]: sceneToDraft(payload.scene!),
        }));
        setSceneSaveState('saved');
      } catch (saveError) {
        setSceneSaveState('error');
        setSceneSaveError(
          saveError instanceof Error ? saveError.message : 'Could not save this scene.',
        );
      } finally {
        setSavingSceneId(null);
      }
    },
    [sceneDrafts],
  );

  const deleteScene = useCallback(
    async (scene: NarrationScriptScene) => {
      const draft = sceneDrafts[scene.id];
      const hasUnsavedChanges = sceneDraftIsDirty(scene, draft);
      const unsavedWarning = hasUnsavedChanges
        ? '\n\nThis scene also has unsaved changes, which will be lost.'
        : '';
      const shouldDelete = window.confirm(
        `Delete Scene ${scene.sceneNumber} permanently?\n\n${narrationPreview(scene.narration)}${unsavedWarning}`,
      );
      if (!shouldDelete) return;

      const currentIndex = visibleScenes.findIndex((item) => item.id === scene.id);
      const nextScene =
        (currentIndex >= 0 ? visibleScenes[currentIndex + 1] : null) ??
        (currentIndex > 0 ? visibleScenes[currentIndex - 1] : null);

      setDeletingSceneId(scene.id);
      setSceneSaveState('saving');
      setSceneSaveError('');
      try {
        if (speakingSceneId === scene.id) {
          try {
            await sendTtsAction('stop');
          } catch {
            // Deletion should still be allowed if the speech bridge is unavailable.
          }
          setSpeakingSceneId(null);
          setSpeechState('idle');
        }

        const response = await fetch(`/api/narration-scripts/scenes/${scene.id}`, {
          method: 'DELETE',
        });
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        if (!response.ok) throw new Error(payload?.error || 'Could not delete this scene.');

        setScenes((current) => current.filter((item) => item.id !== scene.id));
        setSceneDrafts((current) => {
          const next = { ...current };
          delete next[scene.id];
          return next;
        });
        setScripts((current) =>
          current.map((script) =>
            scene.scriptIds.includes(script.id)
              ? { ...script, sceneCount: Math.max(0, script.sceneCount - 1) }
              : script,
          ),
        );
        setExpandedSceneId(nextScene?.id ?? null);
        writeSceneIdToUrl(nextScene?.id ?? null);
        if (nextScene) {
          window.setTimeout(() => {
            sceneCardRefs.current[nextScene.id]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }, 0);
        }
        setSceneSaveState('idle');
      } catch (deleteError) {
        setSceneSaveState('error');
        setSceneSaveError(
          deleteError instanceof Error ? deleteError.message : 'Could not delete this scene.',
        );
      } finally {
        setDeletingSceneId(null);
      }
    },
    [sceneDrafts, sendTtsAction, speakingSceneId, visibleScenes],
  );

  function toggleScene(sceneId: number) {
    if (savingSceneId !== null || deletingSceneId !== null || savingScriptId !== null || deletingScriptId !== null) return;
    if (expandedSceneId === sceneId) {
      const scene = scenes.find((item) => item.id === sceneId);
      if (scene && dirtySceneIds.has(sceneId) && !confirmDiscardUnsavedChanges()) return;
      if (speakingSceneId === sceneId) void stopNarration();
      setSceneSaveState('idle');
      setSceneSaveError('');
      setExpandedSceneId(null);
      writeSceneIdToUrl(null);
      return;
    }

    if (!confirmDiscardUnsavedChanges()) return;

    setSceneSaveState('idle');
    setSceneSaveError('');
    setExpandedSceneId(sceneId);
    writeSceneIdToUrl(sceneId);
    window.requestAnimationFrame(() => {
      sceneCardRefs.current[sceneId]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || event.isComposing) return;

      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) {
        return;
      }

      event.preventDefault();
      if (
        event.repeat ||
        sceneNavigationInFlightRef.current ||
        savingSceneId !== null ||
        deletingSceneId !== null ||
        savingScriptId !== null ||
        deletingScriptId !== null ||
        visibleScenes.length === 0
      ) return;

      const currentIndex = expandedSceneId === null
        ? -1
        : visibleScenes.findIndex((scene) => scene.id === expandedSceneId);
      const direction = event.key === 'ArrowRight' ? 1 : -1;
      if (event.key === 'ArrowLeft' && currentIndex === -1) return;

      const targetIndex = currentIndex === -1 ? 0 : currentIndex + direction;
      if (targetIndex < 0 || targetIndex >= visibleScenes.length) return;
      if (!confirmDiscardUnsavedChanges()) return;

      const targetScene = visibleScenes[targetIndex];
      sceneNavigationInFlightRef.current = true;
      setExpandedSceneId(targetScene.id);
      writeSceneIdToUrl(targetScene.id);
      window.requestAnimationFrame(() => {
        sceneCardRefs.current[targetScene.id]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });

      void playNarration(targetScene).finally(() => {
        sceneNavigationInFlightRef.current = false;
      });
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [
    confirmDiscardUnsavedChanges,
    deletingSceneId,
    expandedSceneId,
    playNarration,
    deletingScriptId,
    savingScriptId,
    savingSceneId,
    visibleScenes,
  ]);

  function handleRefresh() {
    if (savingSceneId !== null || deletingSceneId !== null || savingScriptId !== null || deletingScriptId !== null) return;
    if (!confirmDiscardUnsavedChanges()) return;
    void load(true);
  }

  function selectScript(id: number) {
    if (savingSceneId !== null || deletingSceneId !== null || savingScriptId !== null || deletingScriptId !== null) return;
    if (!confirmDiscardUnsavedChanges()) return;
    if (speakingSceneId !== null) void stopNarration();
    setSelectedScriptId(id);
    writeScriptIdToUrl(id);
    setSceneSaveState('idle');
    setSceneSaveError('');
    setExpandedSceneId(null);
    writeSceneIdToUrl(null);
    setPartFilter('');
    setQuery('');
  }

  return (
    <main className='min-h-screen bg-slate-50 p-6 text-slate-900'>
      <div className='mx-auto max-w-[1500px] space-y-6'>
        <header className='flex flex-wrap items-start justify-between gap-4'>
          <div>
            <Link href='/' className='text-sm text-blue-700'>← Video Editor</Link>
            <h1 className='mt-3 text-3xl font-semibold'>Narration Scripts</h1>
            <p className='mt-1 text-slate-600'>Choose a script at the top, then review its linked Narration Pilot scenes below.</p>
          </div>
          <button className={`${inputClass} inline-flex items-center gap-2`} disabled={loading || refreshing || savingSceneId !== null || deletingSceneId !== null || savingScriptId !== null || deletingScriptId !== null} onClick={handleRefresh}>
            <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} /> Refresh
          </button>
        </header>

        {error && <div role='alert' className='rounded-lg border border-red-200 bg-red-50 p-4 text-red-700'>{error}</div>}

        <section aria-labelledby='scripts-heading' className='overflow-hidden rounded-xl border bg-white shadow-sm'>
          <div className='border-b bg-slate-50 px-5 py-4'>
            <h2 id='scripts-heading' className='text-xl font-semibold'>Scripts</h2>
            <p className='mt-1 text-sm text-slate-600'>One row represents one complete video or tutorial script.</p>
          </div>
          <div className='overflow-x-auto'>
            <table className='min-w-full text-left text-sm'>
              <thead className='border-b bg-white text-xs uppercase tracking-wide text-slate-500'>
                <tr><th className='px-5 py-3'>Script Title</th><th className='px-5 py-3'>Status</th><th className='px-5 py-3'>Date</th><th className='px-5 py-3'>Scenes</th><th className='px-5 py-3'>Last Edited</th><th className='px-5 py-3'>Actions</th></tr>
              </thead>
              <tbody className='divide-y divide-slate-100'>
                {loading ? <tr><td className='px-5 py-8 text-slate-500' colSpan={6}>Loading scripts…</td></tr> : scripts.length === 0 ? <tr><td className='px-5 py-8 text-slate-500' colSpan={6}>No scripts found.</td></tr> : scripts.map((script) => {
                  const draft = scriptDrafts[script.id] ?? scriptToDraft(script);
                  const isEditing = editingScriptId === script.id;
                  const isDirty = scriptDraftIsDirty(script, draft);
                  const isSaving = savingScriptId === script.id;
                  const isDeleting = deletingScriptId === script.id;
                  const hasSavedState = scriptSaveState === 'saved' && !isDirty && !isEditing;
                  return <tr key={script.id} className={`cursor-pointer transition-colors hover:bg-blue-50 ${selectedScriptId === script.id ? 'bg-blue-50 ring-1 ring-inset ring-blue-300' : ''}`} onClick={() => selectScript(script.id)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectScript(script.id); } }} tabIndex={0} role='button'>
                    <td className='px-5 py-4 font-medium text-slate-900'>
                      {isEditing ? <input autoFocus aria-label={`Edit title for ${script.title}`} className={`${inputClass} w-full min-w-56`} value={draft.title} onClick={(event) => event.stopPropagation()} onChange={(event) => updateScriptDraft(script, 'title', event.target.value)} onKeyDown={(event) => { event.stopPropagation(); if (event.key === 'Enter') { event.preventDefault(); void saveScript(script); } if (event.key === 'Escape') { event.preventDefault(); cancelScriptEdit(script.id); } }} disabled={isSaving || isDeleting} /> : <button type='button' className='text-left hover:text-blue-700 hover:underline' onClick={(event) => { event.stopPropagation(); beginScriptTitleEdit(script); }}>{script.title}</button>}
                    </td>
                    <td className='px-5 py-4'>
                      <select aria-label={`Status for ${script.title}`} className={`${inputClass} min-w-36`} value={draft.status ?? ''} onClick={(event) => event.stopPropagation()} onChange={(event) => updateScriptDraft(script, 'status', event.target.value)} disabled={isSaving || isDeleting}>
                        <option value=''>No status</option>
                        {scriptStatusOptions.map((status) => <option key={status} value={status}>{status}</option>)}
                      </select>
                    </td>
                    <td className='px-5 py-4'>{script.date || '—'}</td>
                    <td className='px-5 py-4'>{script.sceneCount}</td>
                    <td className='px-5 py-4'>{script.lastEdited ? new Date(script.lastEdited).toLocaleString() : '—'}</td>
                    <td className='px-5 py-4'>
                      <div className='flex flex-wrap items-center gap-2' onClick={(event) => event.stopPropagation()}>
                        {(isDirty || isEditing) && <>
                          <button type='button' onClick={() => void saveScript(script)} disabled={!isDirty || isSaving || isDeleting} className='rounded-lg bg-blue-600 px-3 py-2 text-xs font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50'>{isSaving ? 'Saving…' : 'Save'}</button>
                          <button type='button' onClick={() => cancelScriptEdit(script.id)} disabled={isSaving || isDeleting} className='rounded-lg bg-slate-200 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-300 disabled:cursor-not-allowed disabled:opacity-50'>Cancel</button>
                        </>}
                        <button type='button' onClick={() => void deleteScript(script)} disabled={isSaving || isDeleting || savingSceneId !== null || deletingSceneId !== null} className='inline-flex items-center gap-1 rounded-lg bg-red-100 px-3 py-2 text-xs font-medium text-red-700 hover:bg-red-200 disabled:cursor-not-allowed disabled:opacity-50' title='Delete this script and all linked scenes'>{isDeleting ? 'Deleting…' : <><Trash2 className='h-3.5 w-3.5' /> Delete</>}</button>
                        {hasSavedState && <span className='text-xs font-medium text-green-700'>Saved</span>}
                      </div>
                    </td>
                  </tr>;
                })}
              </tbody>
            </table>
          </div>
          {scriptSaveError && <div role='alert' className='border-t border-red-200 bg-red-50 px-5 py-3 text-sm text-red-700'>{scriptSaveError}</div>}
        </section>

        <section aria-labelledby='scenes-heading' className='overflow-hidden rounded-xl border bg-white shadow-sm'>
          <div className='flex flex-wrap items-start justify-between gap-4 border-b bg-slate-50 px-5 py-4'>
            <div><h2 id='scenes-heading' className='text-xl font-semibold'>Scenes{selectedScript ? ` — ${selectedScript.title}` : ''}</h2><p className='mt-1 text-sm text-slate-600'>{selectedScript ? `${visibleScenes.length} of ${selectedScript.sceneCount} linked scenes · ←/→ navigates and plays` : 'Select a script above.'}</p></div>
            <div className='flex flex-wrap gap-2'><select aria-label='Filter scenes by Part' className={inputClass} value={partFilter} onChange={(event) => setPartFilter(event.target.value)} disabled={!selectedScript || dirtySceneIds.size > 0} title={dirtySceneIds.size > 0 ? 'Save or cancel changes before filtering.' : undefined}><option value=''>All Parts</option>{parts.map((part) => <option key={part} value={part}>{part}</option>)}</select><input aria-label='Search scenes' className={inputClass} placeholder='Search scenes…' value={query} onChange={(event) => setQuery(event.target.value)} disabled={!selectedScript || dirtySceneIds.size > 0} title={dirtySceneIds.size > 0 ? 'Save or cancel changes before searching.' : undefined} /></div>
          </div>
          {selectedScript && selectedScript.outline && <details className='border-b px-5 py-3'><summary className='cursor-pointer text-sm font-medium text-slate-700'>View complete outline</summary><pre className='mt-3 whitespace-pre-wrap text-sm text-slate-600'>{selectedScript.outline}</pre></details>}
          {speechError && <div role='alert' className='border-b border-red-200 bg-red-50 px-5 py-3 text-sm text-red-700'>{speechError}</div>}
          {sceneSaveError && <div role='alert' className='border-b border-red-200 bg-red-50 px-5 py-3 text-sm text-red-700'>{sceneSaveError}</div>}
          <div className='space-y-3 p-4'>
            {!selectedScript ? <p className='px-1 py-8 text-slate-500'>Select a script to see its scenes.</p> : visibleScenes.length === 0 ? <p className='px-1 py-8 text-slate-500'>No scenes match this selection.</p> : visibleScenes.map((scene) => {
              const isExpanded = expandedSceneId === scene.id;
              const isSpeaking = speakingSceneId === scene.id;
              const draft = sceneDrafts[scene.id] ?? sceneToDraft(scene);
              const isDirty = sceneDraftIsDirty(scene, draft);
              const isSaving = savingSceneId === scene.id;
              const isDeleting = deletingSceneId === scene.id;
              return (
                <article
                  key={scene.id}
                  ref={(element) => { sceneCardRefs.current[scene.id] = element; }}
                  className={`overflow-hidden rounded-xl border bg-white shadow-sm transition-shadow ${isExpanded ? 'border-blue-300 ring-1 ring-blue-200' : 'border-slate-200'}`}
                >
                  <button
                    type='button'
                    className='w-full px-5 py-4 text-left hover:bg-slate-50'
                    aria-expanded={isExpanded}
                    onClick={() => toggleScene(scene.id)}
                  >
                    <div className='flex flex-wrap items-center gap-2'>
                      {isExpanded ? <ChevronDown className='h-4 w-4 text-blue-600' /> : <ChevronRight className='h-4 w-4 text-slate-400' />}
                      <span className='font-semibold'>Scene {scene.sceneNumber}</span>
                      {scene.part && <span className='rounded-full bg-slate-100 px-2 py-1 text-xs font-medium text-slate-600'>{scene.part}</span>}
                      {isSpeaking && <span className='rounded-full bg-purple-100 px-2 py-1 text-xs font-medium text-purple-700'>{speechState === 'paused' ? 'Paused' : 'Speaking'}</span>}
                    </div>
                    <p className='mt-2 line-clamp-2 whitespace-pre-wrap text-sm text-slate-700'>{scene.narration || 'No narration'}</p>
                    <p className='mt-2 line-clamp-1 text-xs text-slate-500'>On screen: {scene.onScreen || '—'}</p>
                  </button>

                  {isExpanded && (
                    <div className='border-t bg-slate-50/70 px-5 py-4'>
                      <div className='mb-4 flex flex-wrap items-center gap-2'>
                        <button
                          type='button'
                          onClick={() => void playNarration(scene)}
                          className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium ${isSpeaking && speechState === 'speaking' ? 'bg-amber-100 text-amber-800 hover:bg-amber-200' : isSpeaking && speechState === 'paused' ? 'bg-green-100 text-green-800 hover:bg-green-200' : 'bg-purple-100 text-purple-800 hover:bg-purple-200'}`}
                          title={isSpeaking && speechState === 'speaking' ? 'Pause narration' : isSpeaking && speechState === 'paused' ? 'Resume narration' : 'Play narration with Narration Pilot'}
                        >
                          {isSpeaking && speechState === 'speaking' ? <Pause className='h-4 w-4' /> : isSpeaking && speechState === 'paused' ? <Play className='h-4 w-4' /> : <Play className='h-4 w-4' />}
                          {isSpeaking && speechState === 'speaking' ? 'Pause' : isSpeaking && speechState === 'paused' ? 'Resume' : 'Play Narration'}
                        </button>
                        {isSpeaking && <button type='button' onClick={() => void stopNarration()} className='inline-flex items-center gap-2 rounded-lg bg-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-300'><Square className='h-4 w-4' /> Stop</button>}
                        <button
                          type='button'
                          onClick={() => void saveScene(scene)}
                          disabled={!isDirty || isSaving || isDeleting}
                          className='rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50'
                        >
                          {isSaving && sceneSaveState === 'saving' ? 'Saving…' : 'Save Changes'}
                        </button>
                        <button
                          type='button'
                          onClick={() => {
                            setSceneDrafts((current) => {
                              const next = { ...current };
                              delete next[scene.id];
                              return next;
                            });
                            setSceneSaveState('idle');
                            setSceneSaveError('');
                          }}
                          disabled={!isDirty || isSaving || isDeleting}
                          className='rounded-lg bg-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-300 disabled:cursor-not-allowed disabled:opacity-50'
                        >
                          Cancel
                        </button>
                        <button
                          type='button'
                          onClick={() => void deleteScene(scene)}
                          disabled={isSaving || isDeleting}
                          className='rounded-lg bg-red-100 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-200 disabled:cursor-not-allowed disabled:opacity-50'
                        >
                          {isDeleting ? 'Deleting…' : 'Delete Scene'}
                        </button>
                        {isDirty && <span className='rounded-full bg-amber-100 px-2 py-1 text-xs font-medium text-amber-800'>Unsaved changes</span>}
                        {sceneSaveState === 'saved' && !isDirty && <span className='text-xs font-medium text-green-700'>Saved</span>}
                      </div>

                      <div className='grid gap-4 md:grid-cols-2'>
                        <label className='text-xs font-semibold uppercase tracking-wide text-slate-500'>
                          Part
                          <input className={`${inputClass} mt-1 block w-full normal-case font-normal`} value={draft.part ?? ''} onChange={(event) => updateSceneDraft(scene, 'part', event.target.value)} disabled={isSaving || isDeleting} />
                        </label>
                        <label className='text-xs font-semibold uppercase tracking-wide text-slate-500'>
                          Language
                          <input className={`${inputClass} mt-1 block w-full normal-case font-normal`} value={draft.language ?? ''} onChange={(event) => updateSceneDraft(scene, 'language', event.target.value)} disabled={isSaving || isDeleting} />
                        </label>
                        <label className='md:col-span-2 text-xs font-semibold uppercase tracking-wide text-slate-500'>
                          Narration
                          <textarea className={`${inputClass} mt-1 block min-h-28 w-full resize-y normal-case font-normal`} value={draft.narration ?? ''} onChange={(event) => updateSceneDraft(scene, 'narration', event.target.value)} disabled={isSaving || isDeleting} />
                        </label>
                        <label className='text-xs font-semibold uppercase tracking-wide text-slate-500'>
                          On Screen
                          <textarea className={`${inputClass} mt-1 block min-h-24 w-full resize-y normal-case font-normal`} value={draft.onScreen ?? ''} onChange={(event) => updateSceneDraft(scene, 'onScreen', event.target.value)} disabled={isSaving || isDeleting} />
                        </label>
                        <label className='text-xs font-semibold uppercase tracking-wide text-slate-500'>
                          Annotation
                          <textarea className={`${inputClass} mt-1 block min-h-24 w-full resize-y normal-case font-normal text-amber-900`} value={draft.annotation ?? ''} onChange={(event) => updateSceneDraft(scene, 'annotation', event.target.value)} disabled={isSaving || isDeleting} />
                        </label>
                        <label className='md:col-span-2 text-xs font-semibold uppercase tracking-wide text-slate-500'>
                          Code
                          <textarea className={`${inputClass} mt-1 block min-h-48 w-full resize-y bg-slate-900 font-mono text-xs text-slate-100`} value={draft.code ?? ''} onChange={(event) => updateSceneDraft(scene, 'code', event.target.value)} disabled={isSaving || isDeleting} spellCheck={false} />
                        </label>
                        <label className='text-xs font-semibold uppercase tracking-wide text-slate-500'>
                          Target File
                          <input className={`${inputClass} mt-1 block w-full normal-case font-normal`} value={draft.targetFile ?? ''} onChange={(event) => updateSceneDraft(scene, 'targetFile', event.target.value)} disabled={isSaving || isDeleting} />
                        </label>
                        <label className='md:col-span-2 text-xs font-semibold uppercase tracking-wide text-slate-500'>
                          Code Instruction
                          <textarea className={`${inputClass} mt-1 block min-h-24 w-full resize-y normal-case font-normal`} value={draft.codeInstruction ?? ''} onChange={(event) => updateSceneDraft(scene, 'codeInstruction', event.target.value)} disabled={isSaving || isDeleting} />
                        </label>
                        <div className='text-xs text-slate-500'><div className='font-semibold uppercase tracking-wide'>Scene Number</div><div className='mt-1 text-sm text-slate-900'>{scene.sceneNumber}</div></div>
                        <div className='text-xs text-slate-500'><div className='font-semibold uppercase tracking-wide'>Last Edited</div><div className='mt-1 text-sm'>{scene.lastEdited ? new Date(scene.lastEdited).toLocaleString() : '—'}</div></div>
                      </div>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        </section>
      </div>
    </main>
  );
}
