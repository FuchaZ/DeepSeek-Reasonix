import { StudioIcon } from "./StudioIcon";
import { providerMark } from "./modelmenu";
import { hasVendorMark, markForProvider, VendorMark } from "./vendormarks";

/** Declared vendor artwork, the door's own name matched against the provider
 *  table, or a library service icon. A provider's mark is its own label, not
 *  the family its models happen to belong to — magpie shows magpie even when
 *  every model behind it reads as somebody else. */
export function ServiceMark({ mark, id, name }: { mark?: string; id: string; name?: string }) {
  if (hasVendorMark(mark)) return <VendorMark slug={mark} size={20} />;
  const derived = markForProvider(name ?? id);
  if (hasVendorMark(derived)) return <VendorMark slug={derived} size={20} />;
  const { tone } = providerMark(id);
  return <i className="mi-mono" data-tone={tone} style={{ "--tone": `var(--cat-${tone + 1})`, width: 20, height: 20 } as React.CSSProperties} aria-hidden="true"><StudioIcon name="server" /></i>;
}
