import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { FolderOpen } from "lucide-react";

export function DataSettings() {
  const [dataDirs, setDataDirs] = useState<{ settings: string; logs: string }>({ settings: "", logs: "" });

  useEffect(() => {
    invoke<{ settings: string; logs: string }>("cmd_get_data_dir").then(setDataDirs);
  }, []);

  return (
    <Card>
      <CardHeader>
        <CardTitle>用户数据</CardTitle>
        <CardDescription>设置文件与日志的存储位置</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <Label>设置文件</Label>
            <p className="text-xs text-muted-foreground truncate">{dataDirs.settings}</p>
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
        <Separator />
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <Label>日志文件</Label>
            <p className="text-xs text-muted-foreground truncate">{dataDirs.logs}</p>
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
      </CardContent>
    </Card>
  );
}
