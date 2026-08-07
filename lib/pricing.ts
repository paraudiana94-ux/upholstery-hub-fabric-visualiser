export interface PricingInputs {
  quantity: number;
  labourCost: number;
  pricePerMetre: number;
  minMetres: number;
  maxMetres: number;
}

export interface EstimateRange {
  low: number;
  high: number;
}

function isValidNumber(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

export function calculateIndicativeEstimate(
  inputs: PricingInputs,
): EstimateRange | null {
  const { quantity, labourCost, pricePerMetre, minMetres, maxMetres } = inputs;

  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10) {
    return null;
  }

  if (
    !isValidNumber(labourCost) ||
    !isValidNumber(pricePerMetre) ||
    !isValidNumber(minMetres) ||
    !isValidNumber(maxMetres) ||
    minMetres > maxMetres
  ) {
    return null;
  }

  const low = quantity * (labourCost + pricePerMetre * minMetres);
  const high = quantity * (labourCost + pricePerMetre * maxMetres);

  if (!Number.isFinite(low) || !Number.isFinite(high) || low > high) {
    return null;
  }

  return { low, high };
}

