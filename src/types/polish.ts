export interface PolishProvider {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
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

export const builtinPrompt: PolishPrompt = {
  id: "builtin-oral-to-written",
  name: "口语转书面语",
  content:
    "请将以下口语化的文字转换为书面语，保持原意不变，修正语法错误，使表达更加规范流畅。只输出润色后的文字，不要添加任何解释。\n\n{{text}}",
};

export const defaultPolishSettings: PolishSettings = {
  enabled: false,
  selectedProviderId: "",
  selectedPromptId: builtinPrompt.id,
  providers: [],
  prompts: [builtinPrompt],
};
