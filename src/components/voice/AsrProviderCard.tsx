import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Pencil, Plug } from "lucide-react";
import type { AsrProviderMeta, AsrProviderConfig, AsrProviderType } from "@/types/asr";

interface AsrProviderCardProps {
  meta: AsrProviderMeta;
  config: AsrProviderConfig;
  isSelected: boolean;
  onSelect: (type: AsrProviderType) => void;
  onEdit: (meta: AsrProviderMeta) => void;
}

function isConfigured(meta: AsrProviderMeta, config: AsrProviderConfig): boolean {
  return meta.fields
    .filter((f) => f.required)
    .every((f) => config[f.key]?.trim());
}

export function AsrProviderCard({ meta, config, isSelected, onSelect, onEdit }: AsrProviderCardProps) {
  const [testing, setTesting] = useState(false);
  const configured = isConfigured(meta, config);

  const handleTestConnection = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!configured) {
      toast.error("请先配置认证信息");
      return;
    }
    setTesting(true);
    try {
      const msg = await invoke<string>("cmd_test_asr_connection", {
        providerType: meta.type,
        credentials: config,
      });
      toast.success(msg);
    } catch (err) {
      toast.error(`测试失败: ${err}`);
    } finally {
      setTesting(false);
    }
  };

  const handleClick = () => {
    if (!configured) {
      toast.error("请先点击配置按钮填写认证信息");
      return;
    }
    onSelect(meta.type);
  };

  return (
    <Card
      className={`cursor-pointer transition-colors ${isSelected ? "border-primary" : "hover:border-muted-foreground/30"}`}
      onClick={handleClick}
    >
      <CardContent>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1 space-y-1">
            <p className="font-medium text-sm">
              {meta.name}
              {isSelected && (
                <Badge className="text-[10px] px-1.5 py-0 ml-1.5 bg-primary text-primary-foreground">使用中</Badge>
              )}
              {!configured && (
                <Badge variant="outline" className="text-[10px] px-1.5 py-0 ml-1.5">未配置</Badge>
              )}
            </p>
            <p className="text-xs text-muted-foreground">{meta.description}</p>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              disabled={testing}
              onClick={handleTestConnection}
              title="测试连接"
            >
              <Plug className={`size-3.5 ${testing ? "animate-pulse" : ""}`} />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              onClick={(e) => { e.stopPropagation(); onEdit(meta); }}
              title="配置"
            >
              <Pencil className="size-3.5" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
