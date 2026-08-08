export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className="grid h-7 w-7 shrink-0 place-items-center" aria-hidden>
        <img src="/precipice-mark.png" alt="" className="h-7 w-7 object-contain" />
      </span>
      {!compact && <span className="font-pixel text-[15px] text-fg">Precipice</span>}
    </span>
  );
}
