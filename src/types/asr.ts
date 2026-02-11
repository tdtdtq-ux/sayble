// ASR Provider 类型标识
export type AsrProviderType = "sapi" | "volcengine";

// 表单字段描述，驱动动态表单渲染
export interface AsrProviderField {
  key: string;
  label: string;
  type: "text" | "password" | "select" | "switch";
  placeholder?: string;
  required: boolean;
  options?: { value: string; label: string }[];
  defaultValue?: string;
}

// 内建 Provider 元数据
export interface AsrProviderMeta {
  type: AsrProviderType;
  name: string;
  description: string;
  docUrl?: string;
  fields: AsrProviderField[];
  platform?: "windows" | "macos" | "linux"; // 仅在指定平台显示
}

// 用户填写的认证信息
export type AsrProviderConfig = Record<string, string>;

// 完整 ASR 设置
export interface AsrSettings {
  selectedProvider: AsrProviderType;
  providers: Record<AsrProviderType, AsrProviderConfig>;
}

// 内建 Provider 注册表
export const builtinAsrProviders: AsrProviderMeta[] = [
  {
    type: "sapi",
    name: "Windows 语音识别",
    description: "使用 Windows 内建语音识别，无需配置密钥，需安装对应语言包",
    fields: [],
    platform: "windows",
  },
  {
    type: "volcengine",
    name: "豆包识别2.0",
    description: "字节跳动旗下的语音识别服务，支持中文、英文及自动检测",
    docUrl: "https://www.volcengine.com/docs/6561/1354869?lang=zh",
    fields: [
      {
        key: "appId",
        label: "App ID",
        type: "text",
        placeholder: "输入 App ID",
        required: true,
      },
      {
        key: "accessKey",
        label: "Access Key",
        type: "password",
        placeholder: "输入 Access Key",
        required: true,
      },
      {
        key: "language",
        label: "识别语言",
        type: "select",
        required: false,
        options: [
          { value: "zh", label: "中文" },
          { value: "en", label: "英文" },
          { value: "auto", label: "自动检测" },
        ],
        defaultValue: "zh",
      },
      {
        key: "autoPunctuation",
        label: "自动标点",
        type: "switch",
        required: false,
        defaultValue: "true",
      },
    ],
  },
];

// 默认 ASR 设置
export const defaultAsrSettings: AsrSettings = {
  selectedProvider: "sapi",
  providers: {
    sapi: {},
    volcengine: {
      appId: "",
      accessKey: "",
      language: "zh",
      autoPunctuation: "true",
    },
  },
};
