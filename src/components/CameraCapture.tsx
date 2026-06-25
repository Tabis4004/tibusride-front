import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Camera, Check, Loader2, RotateCcw, X } from "lucide-react";

/**
 * Capture photo en plein écran via la caméra du téléphone (getUserMedia).
 *
 * Volontairement, il n'existe AUCUN moyen d'importer un fichier depuis la
 * galerie ici : seule la caméra live peut produire l'image. C'est une
 * exigence de sécurité (ex. photo de profil chauffeur) — le visage capturé
 * doit correspondre à la personne présente au moment de l'enrôlement, pas à
 * une photo choisie après coup.
 */
export function CameraCapture({
  title = "Prendre une photo",
  hint,
  facingMode = "user",
  onCapture,
  onClose,
}: {
  title?: string;
  hint?: string;
  facingMode?: "user" | "environment";
  onCapture: (photo: { base64: string; contentType: "image/jpeg" }) => void | Promise<void>;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [captured, setCaptured] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          setError("Caméra non disponible sur cet appareil/navigateur.");
          return;
        }
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode, width: { ideal: 720 }, height: { ideal: 720 } },
          audio: false,
        });
        if (!active) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
      } catch {
        setError("Accès à la caméra refusé ou indisponible. Autorisez l'appareil photo dans les réglages de votre navigateur.");
      }
    })();
    return () => {
      active = false;
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, [facingMode]);

  const takePhoto = () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const size = Math.min(video.videoWidth, video.videoHeight);
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const sx = (video.videoWidth - size) / 2;
    const sy = (video.videoHeight - size) / 2;
    ctx.drawImage(video, sx, sy, size, size, 0, 0, size, size);
    setCaptured(canvas.toDataURL("image/jpeg", 0.85));
  };

  const confirm = async () => {
    if (!captured) return;
    const base64 = captured.split(",")[1] ?? "";
    setBusy(true);
    try {
      await onCapture({ base64, contentType: "image/jpeg" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/90 p-4">
      <div className="flex w-full max-w-sm items-center justify-between text-white">
        <span className="text-sm font-medium">{title}</span>
        <button type="button" onClick={onClose} className="rounded-full p-1.5 hover:bg-white/10" aria-label="Fermer">
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="relative mt-4 aspect-square w-full max-w-sm overflow-hidden rounded-3xl bg-black">
        {error ? (
          <div className="flex h-full items-center justify-center p-6 text-center text-sm text-white/80">{error}</div>
        ) : captured ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={captured} alt="Photo capturée" className="h-full w-full object-cover" />
        ) : (
          <video
            ref={videoRef}
            muted
            playsInline
            className={facingMode === "user" ? "h-full w-full scale-x-[-1] object-cover" : "h-full w-full object-cover"}
          />
        )}
      </div>

      {hint && !error && (
        <p className="mt-3 max-w-sm text-center text-xs text-white/60">{hint}</p>
      )}

      <div className="mt-4 flex w-full max-w-sm gap-2">
        {error ? (
          <Button className="flex-1" variant="outline" onClick={onClose}>Fermer</Button>
        ) : captured ? (
          <>
            <Button variant="outline" className="flex-1 text-white" onClick={() => setCaptured(null)} disabled={busy}>
              <RotateCcw className="mr-1.5 h-4 w-4" />Reprendre
            </Button>
            <Button className="flex-1" onClick={confirm} disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : (
                <>
                  <Check className="mr-1.5 h-4 w-4" />Utiliser cette photo
                </>
              )}
            </Button>
          </>
        ) : (
          <Button className="flex-1" onClick={takePhoto}>
            <Camera className="mr-1.5 h-4 w-4" />Prendre la photo
          </Button>
        )}
      </div>
    </div>
  );
}
