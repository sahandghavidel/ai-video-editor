export type TextStyling = {
  fontColor: string;
  borderWidth: number;
  borderColor: string;
  shadowX: number;
  shadowY: number;
  shadowColor: string;
  shadowOpacity: number;
  fontFamily: string;
  bgColor?: string;
  bgOpacity?: number;
  bgSize?: number;
};

export type TranscriptionWord = {
  word: string;
  start: number;
  end: number;
};
