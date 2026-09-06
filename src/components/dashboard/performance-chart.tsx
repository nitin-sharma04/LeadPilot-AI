"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { performanceSeries } from "@/data/demo";

export function PerformanceChart() {
  return (
    <Card className="h-full">
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <div>
          <CardTitle>Lead & Conversion Performance</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            Demo series for the last 30 days
          </p>
        </div>
      </CardHeader>
      <CardContent className="h-[300px] pb-4 sm:h-[320px]">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={performanceSeries} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="leadsFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#0f766e" stopOpacity={0.25} />
                <stop offset="100%" stopColor="#0f766e" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="convFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#0284c7" stopOpacity={0.2} />
                <stop offset="100%" stopColor="#0284c7" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
            <XAxis
              dataKey="date"
              tick={{ fill: "#64748b", fontSize: 12 }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tick={{ fill: "#64748b", fontSize: 12 }}
              axisLine={false}
              tickLine={false}
              width={32}
            />
            <Tooltip
              contentStyle={{
                borderRadius: 8,
                border: "1px solid #e2e8f0",
                boxShadow: "0 8px 24px rgba(15,23,42,0.08)",
              }}
            />
            <Legend
              verticalAlign="top"
              height={28}
              iconType="circle"
              wrapperStyle={{ fontSize: 12, color: "#64748b" }}
            />
            <Area
              type="monotone"
              dataKey="leads"
              name="Leads"
              stroke="#0f766e"
              fill="url(#leadsFill)"
              strokeWidth={2}
            />
            <Area
              type="monotone"
              dataKey="conversions"
              name="Conversions"
              stroke="#0284c7"
              fill="url(#convFill)"
              strokeWidth={2}
            />
          </AreaChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
