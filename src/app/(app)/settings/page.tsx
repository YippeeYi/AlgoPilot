import { PageHeading } from "@/components/page-heading";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { getConfigurationStatus } from "@/server/config";

export const dynamic = "force-dynamic";

export default function SettingsPage() {
  const status = getConfigurationStatus();
  const labels = {
    missing: "未配置",
    incomplete: "配置不完整",
    configured: "已填写配置 · 未验证连接",
  };
  return (
    <>
      <PageHeading
        eyebrow="YOUR PREFERENCES"
        title="个人设置"
        description="管理训练偏好和数据来源。模型凭据仅由服务端读取。"
      />
      <div className="grid gap-6 xl:grid-cols-2">
        <Card className="shadow-none">
          <CardHeader>
            <CardTitle className="text-base">Codeforces 公开资料</CardTitle>
          </CardHeader>
          <CardContent>
            <label htmlFor="cf-handle" className="mb-2 block text-sm">
              CF Handle
            </label>
            <Input id="cf-handle" placeholder="尚未关联" disabled />
            <p className="mt-3 text-xs leading-6 text-muted-foreground">
              公开数据同步将在 M3 接入。填写 Handle 不等于验证账号归属。
            </p>
            <Button className="mt-5" disabled>
              保存并同步
            </Button>
          </CardContent>
        </Card>
        <Card className="shadow-none">
          <CardHeader>
            <CardTitle className="text-base">服务配置状态</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span>Supabase</span>
              <Badge variant="secondary">{labels[status.supabase]}</Badge>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span>LLM 模型</span>
              <Badge variant="secondary">{labels[status.llm]}</Badge>
            </div>
            <p className="text-xs leading-6 text-muted-foreground">
              这里仅检查环境配置是否完整；连接与账户验证由认证流程执行。模型调用将在
              M2 接入。
            </p>
          </CardContent>
        </Card>
        <Card className="shadow-none">
          <CardHeader>
            <CardTitle className="text-base">训练偏好</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p>默认提示等级：L0</p>
            <p>训练中算法标签：隐藏</p>
            <p className="text-xs leading-6 text-muted-foreground">
              本阶段保留默认训练偏好。深浅主题可通过顶部按钮切换，并保存在本机。
            </p>
          </CardContent>
        </Card>
        <Card className="shadow-none">
          <CardHeader>
            <CardTitle className="text-base">个人数据</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-5 text-sm leading-6 text-muted-foreground">
              真实训练与思路版本已按账户保存。公开预览不保存数据；数据导出与删除将在
              M4 接入。
            </p>
            <div className="flex gap-3">
              <Button variant="outline" disabled>
                导出数据
              </Button>
              <Button variant="outline" disabled>
                删除数据
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
