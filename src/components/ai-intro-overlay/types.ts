export type AiIntroSourceSegment = {
  startTime: number;
  endTime: number;
};

export type AiIntroClipSuggestion = {
  id: string;
  sourceStartTime: number;
  sourceEndTime: number;
  transcript: string;
  reason: string;
};

export type AiIntroSuggestionResponse = {
  sourceDuration: number;
  targetText: string;
  suggestions: AiIntroClipSuggestion[];
};
