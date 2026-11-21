// Screening categories, shared by entry, server validation and saved snapshots.
export const DEFAULT_BP_THRESHOLDS = Object.freeze({
  lowSystolicMax: 89,
  lowDiastolicMax: 59,
  elevatedSystolicMin: 120,
  stage1SystolicMin: 130,
  stage1DiastolicMin: 80,
  stage2SystolicMin: 140,
  stage2DiastolicMin: 90,
  crisisSystolicMin: 181,
  crisisDiastolicMin: 121,
});

export const BP_READING_BOUNDS = Object.freeze({ min: 40, max: 300, diastolicMin: 20, diastolicMax: 200 });

export const BP_CATEGORIES = Object.freeze({
  normal: { code: 'normal', label: 'Normal', severity: 0, alertLevel: 'normal', message: 'Blood pressure is within the reference range.' },
  elevated: { code: 'elevated', label: 'Elevated', severity: 1, alertLevel: 'monitor', message: 'Elevated reading. Recheck and monitor according to the clinical protocol.' },
  stage1: { code: 'stage1', label: 'Stage 1 Hypertension', severity: 2, alertLevel: 'assessment', message: 'High blood pressure reading. Arrange appropriate clinical assessment.' },
  stage2: { code: 'stage2', label: 'Stage 2 Hypertension', severity: 3, alertLevel: 'urgent', message: 'Very high blood pressure reading. Prompt clinical assessment is needed.' },
  // Keep the persisted crisis code compatible with historical snapshots.
  crisis: { code: 'crisis', label: 'Severe Hypertension', severity: 4, alertLevel: 'crisis', message: 'Arrange prompt clinical evaluation according to protocol. Assess for emergency symptoms; a reading alone does not establish a hypertensive emergency.' },
  emergency: { code: 'emergency', label: 'Hypertensive Emergency', severity: 5, emergency: true, alertLevel: 'emergency', message: 'Immediate emergency evaluation is required. Do not delay emergency care to repeat measurements or complete this form.' },
});

export function parseBloodPressure(value) {
  if (value !== null && typeof value === 'object') {
    if (Array.isArray(value)) return null;
    const validPart = (part) => (typeof part === 'number' && Number.isInteger(part))
      || (typeof part === 'string' && /^\d{2,3}$/.test(part.trim()));
    if (!validPart(value.systolic) || !validPart(value.diastolic)) return null;
    return parseBloodPressure(`${value.systolic}/${value.diastolic}`);
  }
  if (typeof value !== 'string') return null;
  const match = /^(\d{2,3})\s*\/\s*(\d{2,3})$/.exec(value.trim());
  if (!match) return null;
  const systolic = Number(match[1]);
  const diastolic = Number(match[2]);
  const { min, max, diastolicMin, diastolicMax } = BP_READING_BOUNDS;
  if (systolic < min || systolic > max || diastolic < diastolicMin || diastolic > diastolicMax || systolic <= diastolic) return null;
  return { systolic, diastolic };
}

export const BP_EMERGENCY_SYMPTOMS = Object.freeze({
  chestPain: /\bchest (?:pain|pressure|discomfort)\b/g,
  shortnessOfBreath: /\b(?:shortness of breath|difficulty breathing|breathing difficulty|breathlessness|dyspnea|unable to breathe|gasping|severe respiratory distress)\b/g,
  backPain: /\bback pain\b/g,
  numbnessOrWeakness: /\b(?:numbness|weakness|facial droop|facial asymmetry)\b/g,
  visionChanges: /\b(?:changes? in vision|vision changes|blurred vision|visual disturbances?|loss of vision)\b/g,
  difficultySpeaking: /\b(?:difficulty speaking|slurred speech|trouble speaking)\b/g,
  acuteNeurologicalSymptoms: /\b(?:unconscious|unresponsive|altered (?:mental status|consciousness)|seizures?|convulsions?)\b/g,
});

export function bloodPressureSymptomsFromText(value = '') {
  const symptoms = {};
  // Carry negation across lists ("denies chest pain and shortness of breath").
  // A new affirmative subject or contrast begins an independent assertion.
  for (const clause of String(value).toLowerCase().split(/[\n;.!?]|\b(?:but|however|although)\b|,?\s+(?=(?:reports|has|complains of|experiencing)\b)/)) {
    if (/\b(?:family history|mother|father|sister|brother|history of|resolved|previously|chronic|longstanding|if|possible|suspected|rule out)\b/.test(clause)) continue;
    for (const [key, pattern] of Object.entries(BP_EMERGENCY_SYMPTOMS)) {
      for (const match of clause.matchAll(pattern)) {
        const before = clause.slice(0, match.index);
        const after = clause.slice(match.index + match[0].length);
        if (/\b(?:no|denies|denied|without|negative for|not|does not have|absent)\b/.test(before)
          || /^\s*[:=-]?\s*(?:(?:is|are)\s+)?(?:no|absent|denied|negative|resolved)\b/.test(after)) continue;
        symptoms[key] = true;
      }
    }
  }
  return symptoms;
}

export function classifyBloodPressure(reading, context = {}) {
  const parsed = parseBloodPressure(reading);
  if (!parsed) return null;
  const { systolic, diastolic } = parsed;
  const symptoms = bloodPressureSymptomsFromText([
    context?.chiefComplaint, context?.findings, context?.clinicalFindingsDiagnosis,
  ].filter(Boolean).join('\n'));
  const emergencySymptomsPresent = [...Object.keys(BP_EMERGENCY_SYMPTOMS),
    'severeBreathingDifficulty', 'suspectedStroke', 'alteredConsciousness', 'convulsions',
    'visualDisturbance', 'acuteCardiovascularSymptoms',
  ].some((key) => symptoms[key] === true || context?.symptoms?.[key] === true
    || context?.indicators?.[key] === true || context?.[key] === true);
  const severe = systolic > 180 || diastolic > 120;
  const code = severe ? (emergencySymptomsPresent ? 'emergency' : 'crisis')
    : systolic >= 140 || diastolic >= 90 ? 'stage2'
      : systolic >= 130 || diastolic >= 80 ? 'stage1'
        : systolic >= 120 ? 'elevated' : 'normal';
  const meta = BP_CATEGORIES[code];
  return { ...meta, ...parsed, category: meta.label, emergency: code === 'emergency',
    emergencySymptomsPresent, referralEvaluationRequired: severe,
    urgency: severe ? (code === 'emergency' ? 'immediate' : 'prompt') : null,
    source: 'default' };
}
