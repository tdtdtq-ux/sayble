import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { FolderOpen } from "lucide-react";

export function DataSettings() {
  const [dataDirs, setDataDirs] = useState<{ settings: string; logs: string }>({ settings: "", logs: "" });

  useEffect(() => {
    invoke<{ settings: string; logs: string }>("cmd_get_data_dir").then(setDataDirs);
  }, []);

  return (
    <div className="space-y-6">
      <h2 className="text-base font-semibold">数据</h2>

      <div className="space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <Label>设置文件</Label>
            <p className="text-xs text-muted-foreground truncate mt-0.5">{dataDirs.settings}</p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="shrink-0"
            onClick={() => revealItemInDir(dataDirs.settings)}
          >
            <FolderOpen className="size-4 mr-1.5" />
            打开
          </Button>
        </div>
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <Label>日志文件</Label>
            <p className="text-xs text-muted-foreground truncate mt-0.5">{dataDirs.logs}</p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="shrink-0"
            onClick={() => revealItemInDir(dataDirs.logs)}
          >
            <FolderOpen className="size-4 mr-1.5" />
            打开
          </Button>
        </div>
      </div>
    </div>
  );
}
