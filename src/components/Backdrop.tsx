import { SpaceBackground } from "./SpaceBackground";

/**
 * The page background: the animated space scene by default, or a room's custom
 * image (set by the room's creator). A custom image gets a dark wash so chat
 * text stays readable over bright photos.
 */
export function Backdrop({ image }: { image: string | null }) {
  if (!image) return <SpaceBackground />;
  return (
    <div className="fixed inset-0 -z-10 pointer-events-none" aria-hidden="true">
      <div className="absolute inset-0 bg-center bg-cover" style={{ backgroundImage: `url("${image}")` }} />
      <div className="absolute inset-0 bg-[#05060b]/30" />
    </div>
  );
}
