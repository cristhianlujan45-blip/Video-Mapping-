import { useEffect, useState } from 'react';
import { useShow } from '../hooks';
import { Modal } from '../controls';
import { lujan } from '../../api';
import { PRESET_LABEL, PRESET_QUALITY, profileHardware, type Preset, type Profile } from '../../core/hardware';
import { ProfileView } from './System';

/** First start: analyse the hardware and recommend a quality preset. */
export function FirstRun() {
  const s = useShow();
  const [open, setOpen] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  useEffect(() => {
    void lujan?.invoke<{ hardwareProfiled: boolean }>('settings:get').then(async (st) => {
      if (st.hardwareProfiled || s.info?.selfTest) return;
      setOpen(true);
      setProfile(await profileHardware());
    });
  }, [s]);
  if (!open) return null;
  const apply = (p: Preset) => {
    const q = PRESET_QUALITY[p];
    s.setQuality({ previewScale: q.previewScale, previewFps: q.previewFps, particleQuality: q.particleQuality, maxFps: q.maxFps });
    s.update((pr) => ({ ...pr, tracking: { ...pr.tracking, quality: q.tracking } }), { undoable: false });
    void lujan?.invoke('settings:set', { hardwareProfiled: true, qualityPreset: p });
    setOpen(false);
  };
  return (
    <Modal
      title="Bienvenido: análisis del equipo"
      onClose={() => apply(profile?.recommended ?? 'balanced')}
      footer={
        profile ? (
          <>
            {(['low', 'balanced', 'high', 'ultra'] as Preset[]).map((p) => (
              <button key={p} className={`btn ${p === profile.recommended ? 'primary' : ''}`} onClick={() => apply(p)}>
                {PRESET_LABEL[p]}
                {p === profile.recommended ? ' (RECOMENDADO)' : ''}
              </button>
            ))}
          </>
        ) : undefined
      }
    >
      {!profile ? <p>Analizando GPU, CPU, memoria, pantallas, cámaras y códecs…</p> : <ProfileView profile={profile} />}
      <p className="hint">El preset solo ajusta previews, partículas y tracking. La calidad de las salidas finales es siempre la que configures.</p>
    </Modal>
  );
}
