import Link from "next/link";
import { PageHeading } from "@/components/page-heading";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CfAccountSettings } from "@/components/learning/cf-account";
import { Button } from "@/components/ui/button";
import { readTutorConfig } from "@/server/tutor/config";
import { getConfigurationStatus } from "@/server/config";

export const dynamic = "force-dynamic";

export default function SettingsPage() {
  const status = getConfigurationStatus();
  const tutorConfigured = Boolean(readTutorConfig());
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
        <CfAccountSettings configured={status.supabase === "configured"} />
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
              <Badge variant="secondary">
                {tutorConfigured
                  ? "AI 运行配置已填写 · 未验证连接"
                  : status.llm === "configured"
                    ? "AI 运行配置不完整"
                    : labels[status.llm]}
              </Badge>
            </div>
            <p className="text-xs leading-6 text-muted-foreground">
              这里只检查配置是否完整，不代表连接成功。AI
              还需匹配的数据库签名配置；真实调用和用量在训练工作台按权限记录。
            </p>
          </CardContent>
        </Card>
        <Card className="shadow-none">
          <CardHeader>
            <CardTitle className="text-base">训练偏好</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <Link className="text-primary underline" href="/dashboard">调整推荐与证据偏好</Link>
            <p>默认提示等级：L0</p>
            <p>训练中算法标签：隐藏</p>
            <p className="text-xs leading-6 text-muted-foreground">
              难度自评、主题与复盘证据授权在推荐页管理。深浅主题可通过顶部按钮切换，并保存在本机。
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
