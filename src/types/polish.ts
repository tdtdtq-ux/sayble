export interface PolishProvider {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
}

export interface PolishPrompt {
  id: string;
  name: string;
  content: string;
}

export interface PolishSettings {
  enabled: boolean;
  selectedProviderId: string;
  selectedPromptId: string;
  providers: PolishProvider[];
  prompts: PolishPrompt[];
}

export const builtinPrompts: PolishPrompt[] = [
  {
    id: "fix-only",
    name: "默认人设",
    content:
      "请只修正以下文字中的错别字和语法错误，不要改变原有的语气、用词风格和表达习惯。只输出修正后的文字，不要添加任何解释。",
  }
];

export const builtinPromptIds = new Set(builtinPrompts.map((p) => p.id));

export const defaultPolishSettings: PolishSettings = {
  enabled: false,
  selectedProviderId: "",
  selectedPromptId: builtinPrompts[0].id,
  providers: [],
  prompts: [...builtinPrompts],
};
