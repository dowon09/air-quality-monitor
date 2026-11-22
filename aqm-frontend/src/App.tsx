import { useEffect, useRef, useState } from "react";
import {
  Activity,
  Cloud,
  Droplets,
  Info,
  Thermometer,
  Wind,
  type LucideIcon,
} from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

interface Reading {
  id: number;
  temperature: number | null;
  humidity: number | null;
  aqi: number | null;
  tvoc: number | null;
  eco2: number | null;
  timestamp: string;
}

const API_ROOT = (import.meta.env.VITE_API_URL || "http://localhost:8000/api").replace(/\/$/, "");
const X_AXIS_TICK_COUNT = 7;
const ranges = [
  { label: "1 hr", hours: 1 },
  { label: "24 hr", hours: 24 },
  { label: "7 days", hours: 168 },
] as const;
const chartMetrics = [
  { key: "temperature", label: "Temperature", unit: "°C" },
  { key: "humidity", label: "Humidity", unit: "%" },
  { key: "aqi", label: "AQI", unit: "" },
  { key: "tvoc", label: "TVOC", unit: "ppb" },
  { key: "eco2", label: "eCO₂", unit: "ppm" },
] as const;
type ChartMetric = typeof chartMetrics[number]["key"];

function aqiStatus(value: number | null) {
  if (value === null) return { label: "Device Offline / No reading", tone: "neutral" };
  if (value == 1) return { label: "Excellent", tone: "good" };
  if (value == 2) return { label: "Good", tone: "good" };
  if (value == 3) return { label: "Moderate", tone: "sensitive" };
  if (value == 4) return { label: "Poor", tone: "unhealthy" };
  if (value == 5) return { label: "Very Poor", tone: "very-unhealthy" };
  return { label: "Device Offline / No reading", tone: "neutral" };
}

function formatTimestamp(timestamp: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(parseTimestamp(timestamp));
}

function parseTimestamp(timestamp: string) {
  const hasTimezone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(timestamp);
  return new Date(hasTimezone ? timestamp : `${timestamp}Z`);
}

function mergeLatestReading(history: Reading[], latest: Reading | null) {
  if (!latest) {
    return history;
  }

  const readingsById = new Map(history.map((reading) => [reading.id, reading]));
  readingsById.set(latest.id, latest);
  return [...readingsById.values()].sort(
    (first, second) => parseTimestamp(first.timestamp).getTime() - parseTimestamp(second.timestamp).getTime(),
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
  unit,
  tone,
  description,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  unit: string;
  tone: string;
  description?: string;
}) {
  return (
    <article className={`metric-card ${tone}`}>
      <div className="metric-heading">
        <span className="metric-icon"><Icon size={17} strokeWidth={1.8} /></span>
        <span>{label}</span>
        {description && (
          <button
            className="metric-info"
            type="button"
            aria-label={`About ${label}`}
            aria-describedby={`metric-info-${label}`}
          >
            <Info size={14} strokeWidth={1.8} aria-hidden="true" />
            <span className="metric-tooltip" id={`metric-info-${label}`} role="tooltip">
              {description}
            </span>
          </button>
        )}
      </div>
      <div className="metric-reading">
        <strong>{value}</strong>
        {unit && <span>{unit}</span>}
      </div>
    </article>
  );
}

export default function App() {
  const [latest, setLatest] = useState<Reading | null>(null);
  const [readings, setReadings] = useState<Reading[]>([]);
  const [hours, setHours] = useState<number>(1);
  const [selectedMetric, setSelectedMetric] = useState<ChartMetric>("temperature");
  const [historyError, setHistoryError] = useState("");
  const [latestError, setLatestError] = useState("");
  const latestRef = useRef<Reading | null>(null);
  const error = latestError || historyError;

  useEffect(() => {
    let cancelled = false;

    async function loadHistory() {
      try {
        const response = await fetch(`${API_ROOT}/readings?hours=${hours}`);
        if (!response.ok) {
          throw new Error("The readings service could not be reached.");
        }
        const historyData = await response.json() as Reading[];
        if (!cancelled) {
          setReadings(mergeLatestReading(historyData, latestRef.current));
          setHistoryError("");
        }
      } catch {
        if (!cancelled) setHistoryError("Unable to load readings. Check the connection and try again.");
      }
    }

    loadHistory();
    return () => {
      cancelled = true;
    };
  }, [hours]);

  useEffect(() => {
    let cancelled = false;

    async function pollLatest() {
      try {
        const response = await fetch(`${API_ROOT}/readings/latest`);
        if (!response.ok) {
          throw new Error("The readings service could not be reached.");
        }
        const latestData = await response.json() as Reading | null;
        if (!cancelled) {
          latestRef.current = latestData;
          setLatest(latestData);
          if (latestData) {
            setReadings((current) => mergeLatestReading(current, latestData));
          }
          setLatestError("");
        }
      } catch {
        if (!cancelled) setLatestError("Unable to load readings. Check the connection and try again.");
      }
    }

    pollLatest();
    const interval = window.setInterval(pollLatest, 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  const lastSeenMs = latest ? Date.now() - parseTimestamp(latest.timestamp).getTime() : null;
  const isLive = lastSeenMs !== null && lastSeenMs < 300_000;
  const status = isLive ? aqiStatus(latest?.aqi ?? null) : aqiStatus(null);
  const range = ranges.find((item) => item.hours === hours) ?? ranges[0];
  const now = Date.now();
  const rangeStart = now - range.hours * 60 * 60 * 1000;
  const chartData = readings.map((reading) => ({
    ...reading,
    chartAqi: reading.aqi === null ? null : 6 - reading.aqi,
    chartTime: parseTimestamp(reading.timestamp).getTime(),
  })).filter((reading) => reading.chartTime >= rangeStart);
  const selectedMetricConfig = chartMetrics.find((metric) => metric.key === selectedMetric) ?? chartMetrics[0];
  const metricChartData = chartData.filter((reading) => reading[selectedMetric] !== null);
  const metricValues = metricChartData
    .map((reading) => reading[selectedMetric])
    .filter((value): value is number => value !== null);
  const minimum = Math.min(...metricValues);
  const maximum = Math.max(...metricValues);
  const xAxisTicks = Array.from({ length: X_AXIS_TICK_COUNT }, (_, index) =>
    rangeStart + ((now - rangeStart) * index) / (X_AXIS_TICK_COUNT - 1),
  );

  return (
    <main className="page-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="Air Quality Monitor home">
          <span className="brand-mark"><Wind size={20} strokeWidth={2} /></span>
          <span>Air Quality Monitor</span>
        </a>
      </header>

      <section className="dashboard" id="top">
        {error && <div className="error-banner" role="alert">{error}</div>}

        <section className="overview-grid" aria-label="Current air quality">
          <article className={`aqi-panel ${status.tone}`}>
            <div className="aqi-topline">
              <div className="panel-kicker"><Activity size={15} /> AIR QUALITY INDEX</div>
              <span className={`connection ${isLive ? "connected" : "disconnected"}`}>
                <span />{latest ? (isLive ? "Live" : "Not Connected") : "Sensor not connected"}
              </span>
            </div>
            <div className="aqi-main">
              <div className="aqi-copy">
                <span className="aqi-label">{status.label}</span>
              </div>
            </div>
            <div className="aqi-footer">
              <span>{latest ? `Updated ${formatTimestamp(latest.timestamp)}` : "Waiting for the sensor reading"}</span>
            </div>
            <div className="aqi-scale-bar" aria-hidden="true"><i /></div>
          </article>

          <div className="metrics-grid">
            <MetricCard icon={Thermometer} label="Temperature" value={latest?.temperature == null ? "--" : latest.temperature.toFixed(1)} unit="°C" tone="coral" />
            <MetricCard icon={Droplets} label="Humidity" value={latest?.humidity == null ? "--" : latest.humidity.toFixed(0)} unit="%" tone="gold" />
            <MetricCard icon={Cloud} label="TVOC" value={latest?.tvoc == null ? "--" : latest.tvoc.toFixed(0)} unit="ppb" tone="mint" description="Approximate concentration of airborne chemical pollutants - lower is generally better. Below about 500 ppb is often considered low; higher readings mean more airborne chemicals. There is no single safe cutoff." />
            <MetricCard icon={Wind} label="eCO₂" value={latest?.eco2 == null ? "--" : latest.eco2.toFixed(0)} unit="ppm" tone="blue" description="Estimate of indoor CO₂ - lower is generally better. Around 400–1,000 ppm is a common reference range; above 1,000 is elevated. This is an estimate, not a direct CO₂ reading." />
          </div>
        </section>

        <section className="history-panel" aria-label="Air quality history">
          <div className="history-heading">
            <div>
              <p className="eyebrow">TREND</p>
              <h2>{selectedMetricConfig.label} over time</h2>
            </div>
            <div className="history-controls">
              <div className="range-control" role="group" aria-label="Trend metric">
                {chartMetrics.map((metric) => (
                  <button
                    type="button"
                    key={metric.key}
                    className={selectedMetric === metric.key ? "selected" : ""}
                    onClick={() => setSelectedMetric(metric.key)}
                    aria-pressed={selectedMetric === metric.key}
                  >
                    {metric.label}
                  </button>
                ))}
              </div>
              <div className="range-control" role="group" aria-label="Chart time range">
                {ranges.map((range) => (
                  <button
                    type="button"
                      key={range.hours}
                    className={hours === range.hours ? "selected" : ""}
                    onClick={() => setHours(range.hours)}
                    aria-pressed={hours === range.hours}
                  >
                    {range.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="chart-wrap">
            {metricChartData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={metricChartData} margin={{ top: 16, right: 12, left: 8, bottom: 0 }}>
                  <defs>
                    <linearGradient id="metricFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#2f8e73" stopOpacity={0.24} />
                      <stop offset="100%" stopColor="#2f8e73" stopOpacity={0.015} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} stroke="#e8ece7" strokeDasharray="3 5" />
                  <XAxis
                    dataKey="chartTime"
                    type="number"
                    domain={[rangeStart, now]}
                    tickFormatter={(time: number) => {
                      if (time === rangeStart) return "";

                      if (hours === 1) {
                        return new Intl.DateTimeFormat(undefined, {
                          hour: "numeric",
                          minute: "2-digit",
                        }).format(new Date(time));
                      }

                      return new Intl.DateTimeFormat(undefined, hours === 24
                        ? { hour: "numeric" }
                        : { month: "short", day: "numeric" }).format(new Date(time));
                    }}
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: "#8b958d", fontSize: 11 }}
                    interval="preserveStartEnd"
                    ticks={xAxisTicks}
                  />
                  <YAxis
                    domain={selectedMetric === "aqi" ? [1, 5] : [minimum, maximum]}
                    tickCount={selectedMetric === "aqi" ? 5 : undefined}
                    allowDecimals={selectedMetric !== "aqi"}
                    tickFormatter={(value) => selectedMetric === "aqi"
                      ? aqiStatus(6 - Number(value)).label
                      : value}
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: "#8b958d", fontSize: 11 }}
                    width={ selectedMetric === "aqi" ? 80 : 60 }
                  />
                  <Tooltip
                    labelFormatter={(time) => formatTimestamp(new Date(Number(time)).toISOString())}
                    formatter={(value) => {
                      if (selectedMetric === "aqi") {
                        const label = value == null ? "" : aqiStatus(6 - Number(value)).label;
                        return [`${label}`];
                      }
                      const digits = selectedMetric === "temperature" || selectedMetric === "humidity" ? 1 : 0;
                      const formattedValue = value == null ? "--" : Number(value).toFixed(digits);
                      return [`${formattedValue} ${selectedMetricConfig.unit}`.trim(), selectedMetricConfig.label];
                    }}
                    contentStyle={{ border: "1px solid #e4e9e3", borderRadius: 8, fontSize: 12 }}
                  />
                  <Area
                    type="monotone"
                    dataKey={selectedMetric === "aqi" ? "chartAqi" : selectedMetric}
                    baseValue={selectedMetric === "aqi" ? 1 : "dataMin"}
                    stroke="#28795f"
                    strokeWidth={2.5}
                    fill="url(#metricFill)"
                    connectNulls
                    activeDot={{ r: 4, fill: "#28795f", stroke: "#fff", strokeWidth: 2 }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="chart-empty">
                No {selectedMetricConfig.label} readings in this time range.
              </div>
            )}
          </div>
          <div className="chart-footnote"><span className="legend-dot" /> {selectedMetricConfig.label}{selectedMetricConfig.unit ? ` (${selectedMetricConfig.unit})` : ""} <span className="footnote-separator">·</span></div>
        </section>
      </section>
    </main>
  );
}
