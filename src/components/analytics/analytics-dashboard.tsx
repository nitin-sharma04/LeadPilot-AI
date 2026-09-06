"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency, formatNumber, formatPercent } from "@/lib/format";

const PIE_COLORS = [
  "#0f766e",
  "#0284c7",
  "#7c3aed",
  "#d97706",
  "#dc2626",
  "#64748b",
  "#059669",
];

type AnalyticsData = {
  totalLeads: number;
  qualifiedCount: number;
  meetings: number;
  wonCount: number;
  conversionRate: number;
  avgDealSize: number;
  revenue: number;
  pipelineValue: number;
  hotLeads?: number;
  averageLeadScore?: number;
  analyzedCount?: number;
  sourceDistribution: { name: string; value: number }[];
  funnel: { name: string; value: number }[];
  revenueTrend: { month: string; revenue: number }[];
  scoreDistribution: { name: string; value: number }[];
};

export function AnalyticsDashboard({ data }: { data: AnalyticsData }) {
  const metrics = [
    { label: "Total Leads", value: formatNumber(data.totalLeads) },
    { label: "Hot Leads (90+)", value: formatNumber(data.hotLeads ?? 0) },
    {
      label: "Avg Lead Score",
      value: formatNumber(data.averageLeadScore ?? 0),
    },
    {
      label: "AI Analyzed",
      value: formatNumber(data.analyzedCount ?? 0),
    },
    { label: "Qualified Leads", value: formatNumber(data.qualifiedCount) },
    { label: "Meetings", value: formatNumber(data.meetings) },
    { label: "Won Deals", value: formatNumber(data.wonCount) },
    { label: "Conversion Rate", value: formatPercent(data.conversionRate) },
    { label: "Average Deal Size", value: formatCurrency(data.avgDealSize) },
    { label: "Revenue", value: formatCurrency(data.revenue) },
    { label: "Pipeline Value", value: formatCurrency(data.pipelineValue) },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Analytics"
        description="Performance metrics calculated from your PostgreSQL workspace data."
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {metrics.map((metric) => (
          <Card key={metric.label}>
            <CardContent className="p-5">
              <p className="text-sm text-muted-foreground">{metric.label}</p>
              <p className="mt-2 text-2xl font-semibold tabular-nums tracking-tight">
                {metric.value}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Lead sources</CardTitle>
          </CardHeader>
          <CardContent className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={data.sourceDistribution}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={60}
                  outerRadius={100}
                  paddingAngle={2}
                >
                  {data.sourceDistribution.map((_, index) => (
                    <Cell
                      key={`cell-${index}`}
                      fill={PIE_COLORS[index % PIE_COLORS.length]}
                    />
                  ))}
                </Pie>
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Conversion funnel</CardTitle>
          </CardHeader>
          <CardContent className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.funnel}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                <XAxis
                  dataKey="name"
                  tick={{ fontSize: 12, fill: "#64748b" }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 12, fill: "#64748b" }}
                  axisLine={false}
                  tickLine={false}
                  width={28}
                />
                <Tooltip />
                <Bar dataKey="value" name="Leads" fill="#0f766e" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Revenue trend</CardTitle>
          </CardHeader>
          <CardContent className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data.revenueTrend}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                <XAxis
                  dataKey="month"
                  tick={{ fontSize: 12, fill: "#64748b" }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 12, fill: "#64748b" }}
                  axisLine={false}
                  tickLine={false}
                  width={48}
                />
                <Tooltip formatter={(value) => formatCurrency(Number(value))} />
                <Line
                  type="monotone"
                  dataKey="revenue"
                  name="Revenue"
                  stroke="#0284c7"
                  strokeWidth={2.5}
                  dot={{ r: 4, fill: "#0284c7" }}
                />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Lead score distribution</CardTitle>
          </CardHeader>
          <CardContent className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.scoreDistribution}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                <XAxis
                  dataKey="name"
                  tick={{ fontSize: 12, fill: "#64748b" }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 12, fill: "#64748b" }}
                  axisLine={false}
                  tickLine={false}
                  width={28}
                />
                <Tooltip />
                <Bar dataKey="value" name="Leads" fill="#7c3aed" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
