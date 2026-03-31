export const BAD_WORDS = ['씨발', '병신', '개새', 'fuck', 'shit', 'bitch'] as const;

export type RhythmJudgeLabel = 'GOOD' | 'GREAT' | 'PERFECT' | 'MISS';
export type RhythmJudgeTone = 'good' | 'great' | 'perfect' | 'miss';

export function getRhythmJudgeInfo(
  timingQuality: number,
  earlyPull = false
): { label: RhythmJudgeLabel; tone: RhythmJudgeTone } {
  if (earlyPull) return { label: 'MISS', tone: 'miss' };
  if (timingQuality >= 0.88) return { label: 'PERFECT', tone: 'perfect' };
  if (timingQuality >= 0.66) return { label: 'GREAT', tone: 'great' };
  return { label: 'GOOD', tone: 'good' };
}

export function validateNickname(raw: unknown): string {
  const nickname = String(raw || '').trim();
  if (!nickname) return '닉네임을 입력해주세요.';
  if (nickname.length < 2 || nickname.length > 10) return '닉네임은 2~10자여야 합니다.';

  if (BAD_WORDS.some((word) => nickname.toLowerCase().includes(word))) {
    return '사용할 수 없는 닉네임입니다.';
  }

  return '';
}

