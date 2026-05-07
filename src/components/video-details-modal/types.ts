export type BaserowSelectOption = {
  id: number;
  value: string;
  color?: string;
};

export type BaserowFieldSchema = {
  id: number;
  name: string;
  type: string;
  order?: number;
  primary?: boolean;
  read_only?: boolean;
  select_options?: BaserowSelectOption[];
};

export type BaserowVideoRow = {
  id: number;
  [key: string]: unknown;
};

export type EditorValue = string | string[] | boolean;

export type EditorValueMap = Record<string, EditorValue>;
