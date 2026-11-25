import { parseBloodPressure } from './bloodPressure.js';

export const CLINICAL_SCREENING_CRITERIA_VERSION = 'adult-screening-2026-02';

const asNumber = (value) => {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

export const ageAtDate = (birthDate, at = new Date()) => {
  if (!birthDate) return null;
  const birth = new Date(`${String(birthDate).slice(0, 10)}T00:00:00Z`);
  const date = at instanceof Date ? at : new Date(at);
  if (!Number.isFinite(birth.getTime()) || !Number.isFinite(date.getTime()) || birth > date) return null;
  let years = date.getUTCFullYear() - birth.getUTCFullYear();
  const beforeBirthday = date.getUTCMonth() < birth.getUTCMonth()
    || (date.getUTCMonth() === birth.getUTCMonth() && date.getUTCDate() < birth.getUTCDate());
  if (beforeBirthday) years -= 1;
  return years;
};

const result = (value, classification, severity = 'none', note = '') => ({
  value,
  classification,
  severity,
  note,
});

/**
 * Independent clinical screening flags. These classifications do not produce
 * or override the configurable Low/Moderate/High resident risk score.
 * Adult criteria are deliberately withheld for children and confirmed
 * pregnancy/postpartum until an approved population-specific protocol exists.
 */
export const classifyClinicalVitals = (vitals = {}, { ageYears = null, pregnancy = null } = {}) => {
  const hasAge = ageYears !== null && ageYears !== undefined && Number.isFinite(Number(ageYears));
  const adult = hasAge && Number(ageYears) >= 18;
  const maternal = pregnancy === true || pregnancy?.isPregnant === true
    || pregnancy?.isPostpartum === true || pregnancy?.pregnancyStatus === 'pregnant'
    || pregnancy?.pregnancyStatus === 'postpartum';
  const population = maternal ? 'maternal_review_required'
    : adult ? 'adult' : ageYears == null ? 'age_unknown' : 'pediatric_review_required';
  const bp = parseBloodPressure(vitals.bp);
  const oxygen = asNumber(vitals.o2sat);
  const temperature = asNumber(vitals.temperature);
  const pulse = asNumber(vitals.hr ?? vitals.pulse);
  const respiratory = asNumber(vitals.rr ?? vitals.respiratory);
  const heightCm = asNumber(vitals.heightCm ?? vitals.height_cm);
  const weightKg = asNumber(vitals.weightKg ?? vitals.weight_kg);
  const bmi = heightCm > 0 && weightKg > 0
    ? weightKg / ((heightCm / 100) ** 2)
    : null;
  const populationNote = maternal
    ? 'Use the approved maternal assessment protocol.'
    : ageYears == null ? 'Resident age is unavailable; age-specific screening was not applied.'
      : !adult ? 'Use the approved pediatric protocol.' : '';

  let bloodPressure;
  let lowBloodPressureFlag = false;
  if (!bp) bloodPressure = result(vitals.bp ?? null, 'Not classified', 'unknown', 'A valid systolic/diastolic reading is required.');
  else if (!adult || maternal) {
    bloodPressure = result(`${bp.systolic}/${bp.diastolic}`, 'Not classified', 'review', populationNote);
  } else {
    const { systolic, diastolic } = bp;
    lowBloodPressureFlag = systolic <= 89 || diastolic <= 59;
    const category = systolic >= 180 || diastolic >= 120 ? ['Severe Blood Pressure Alert', 'critical']
      : systolic >= 140 || diastolic >= 90 ? ['Stage 2 Hypertension', 'high']
        : systolic >= 130 || diastolic >= 81 ? ['Stage 1 Hypertension', 'moderate']
          : systolic >= 121 && diastolic <= 80 ? ['Elevated', 'low']
            : ['Normal', 'none'];
    bloodPressure = result(`${systolic}/${diastolic} mmHg`, category[0], category[1],
      lowBloodPressureFlag ? 'Low-reading flag: recheck and assess symptoms and clinical context.' : 'Screening classification only; one reading does not diagnose hypertension.');
  }

  const bmiClass = !adult || maternal ? result(bmi, 'Not classified', 'review', populationNote)
    : bmi === null ? result(null, 'Not assessed', 'unknown', 'Valid height and weight are required.')
      : bmi < 18.5 ? result(bmi, 'Underweight', 'monitor')
        : bmi < 23 ? result(bmi, 'Normal', 'none')
          : bmi < 25 ? result(bmi, 'Overweight', 'monitor')
            : bmi < 30 ? result(bmi, 'Obese Class I', 'high')
              : result(bmi, 'Obese Class II', 'high');

  const oxygenClass = oxygen === null || oxygen < 0 || oxygen > 100
    ? result(oxygen, 'Not assessed', 'unknown', 'Enter a valid percentage from 0 to 100.')
    : !adult || maternal ? result(oxygen, 'Not classified', 'review', populationNote)
      : oxygen < 90 ? result(`${oxygen}%`, 'Critical Low Oxygen Saturation Alert', 'critical')
        : oxygen < 94 ? result(`${oxygen}%`, 'Reduced Oxygen Saturation', 'high')
          : oxygen === 94 ? result('94%', 'Borderline Oxygen Saturation', 'moderate')
            : result(`${oxygen}%`, 'Normal Reference Range', 'none');

  const tempClass = temperature === null || temperature < 25 || temperature > 45
    ? result(temperature, 'Not assessed', 'unknown', 'Enter a valid temperature in Celsius.')
    : !adult || maternal ? result(`${temperature} °C`, 'Not classified', 'review', populationNote)
      : temperature < 35 ? result(`${temperature} °C`, 'Hypothermia Alert', 'critical')
        : temperature < 36.5 ? result(`${temperature} °C`, 'Below Normal Reference Range', 'monitor')
          : temperature <= 37.3 ? result(`${temperature} °C`, 'Normal Reference Range', 'none')
            : temperature < 38 ? result(`${temperature} °C`, 'Above Normal Reference Range', 'monitor')
              : temperature < 40 ? result(`${temperature} °C`, 'Fever', 'high')
                : result(`${temperature} °C`, 'Very High Temperature Alert', 'critical');

  const pulseClass = pulse === null || pulse < 20 || pulse > 250
    ? result(pulse, 'Not assessed', 'unknown', 'Enter a valid resting heart rate.')
    : !adult || maternal ? result(`${pulse} bpm`, 'Not classified', 'review', populationNote)
      : pulse < 60 ? result(`${pulse} bpm`, 'Below Normal Resting Heart Rate', 'monitor')
        : pulse <= 100 ? result(`${pulse} bpm`, 'Normal Reference Range', 'none')
          : pulse < 125 ? result(`${pulse} bpm`, 'Elevated Resting Heart Rate', 'moderate')
            : result(`${pulse} bpm`, 'Priority Clinical Assessment Flag', 'high');

  let respiratoryClass;
  if (respiratory === null || respiratory <= 0 || respiratory > 150) {
    respiratoryClass = result(respiratory, 'Not assessed', 'unknown', 'Enter a valid respiratory rate in breaths per minute.');
  } else if (maternal) {
    respiratoryClass = result(`${respiratory}/min`, 'Not classified', 'review', populationNote);
  } else if (adult) {
    respiratoryClass = respiratory < 12 ? result(`${respiratory}/min`, 'Below Normal Reference Range', 'monitor')
      : respiratory <= 20 ? result(`${respiratory}/min`, 'Normal Reference Range', 'none')
        : respiratory < 30 ? result(`${respiratory}/min`, 'Elevated Respiratory Rate', 'moderate')
          : result(`${respiratory}/min`, 'Priority Clinical Assessment Flag', 'high');
  } else if (hasAge && Number(ageYears) < 5) {
    const ageMonths = Number(ageYears) * 12;
    const threshold = ageMonths < 2 ? 60 : ageMonths < 12 ? 50 : 40;
    respiratoryClass = respiratory >= threshold
      ? result(`${respiratory}/min`, 'Fast Breathing for Age', 'high', `WHO IMCI age threshold: ${threshold}/min.`)
      : result(`${respiratory}/min`, 'Below Fast-Breathing Threshold for Age', 'none', `WHO IMCI age threshold: ${threshold}/min.`);
  } else {
    respiratoryClass = result(`${respiratory}/min`, 'Not classified', 'review', populationNote || 'No approved pediatric threshold is configured for this age.');
  }

  const classifications = {
    bloodPressure,
    bmi: bmiClass,
    oxygenSaturation: oxygenClass,
    respiratoryRate: respiratoryClass,
    temperature: tempClass,
    heartRate: pulseClass,
  };
  const alerts = Object.entries(classifications)
    .filter(([, item]) => ['critical', 'high'].includes(item.severity))
    .map(([indicator, item]) => ({ indicator, classification: item.classification, value: item.value }));
  return {
    criteriaVersion: CLINICAL_SCREENING_CRITERIA_VERSION,
    population,
    lowBloodPressureFlag,
    classifications,
    alerts,
    decisionSupportOnly: true,
  };
};

export default { ageAtDate, classifyClinicalVitals, CLINICAL_SCREENING_CRITERIA_VERSION };
