// A harness's permission control: its id, its values from least to most
// permissive, and the value a process launches with when the control is unset.
export interface PermissionRule {
  controlId: string;
  order: readonly string[];
  launchDefault: string;
}

// A copy of `controls` with `rule.controlId` set to `cap`'s value when the
// effective value ranks above it in `rule.order`. A missing value on either side
// reads as `rule.launchDefault`. Unknown values fail closed: an unknown effective
// value ranks above every known one, and an unknown cap caps at `order[0]`.
export function capPermission(
  controls: Readonly<Record<string, string>>,
  cap: Readonly<Record<string, string>>,
  rule: PermissionRule,
): Record<string, string> {
  const capped = { ...controls };
  const effective = controls[rule.controlId] ?? rule.launchDefault;
  const capValue = cap[rule.controlId] ?? rule.launchDefault;
  const effectiveRank = rule.order.indexOf(effective);
  const isEffectiveKnown = effectiveRank !== -1;
  const isCapKnown = rule.order.includes(capValue);
  const ceiling = isCapKnown ? capValue : rule.order[0];
  const ceilingRank = rule.order.indexOf(ceiling);
  const isAboveCap = !isEffectiveKnown || effectiveRank > ceilingRank;
  if (isAboveCap) {
    capped[rule.controlId] = ceiling;
  }
  return capped;
}
