import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  PointElement,
  LineElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
  Filler,
  Plugin,
} from 'chart.js';

export const PAL = [
  '#235c9d',
  '#4b83ba',
  '#6e9cc9',
  '#408274',
  '#89a9c7',
  '#7194b7',
  '#a1b7cc',
  '#5c9289',
  '#86a3bd',
  '#b0bfd0',
  '#c45963',
];

export const BLUE = '#235c9d';
export const LIGHT = '#4b83ba';
export const PINK = '#c45963';
export const GREY = '#7b8ca2';

let registered = false;

export function setupChartJS(): void {
  if (registered) return;
  registered = true;

  ChartJS.register(
    CategoryScale,
    LinearScale,
    BarElement,
    PointElement,
    LineElement,
    ArcElement,
    Title,
    Tooltip,
    Legend,
    Filler
  );

  ChartJS.defaults.color = '#60738b';
  ChartJS.defaults.font.family = '"Segoe UI", Inter, system-ui, -apple-system, Roboto, Arial, sans-serif';
  ChartJS.defaults.font.size = 11;
  ChartJS.defaults.borderColor = '#e4eaf0';
  ChartJS.defaults.animation = { duration: 250 };

  // Average Line Plugin
  const avgLinePlugin: Plugin = {
    id: 'avgLine',
    afterDatasetsDraw(ch, _args, options) {
      if (!options || options.value == null || !isFinite(options.value)) return;
      const { ctx, chartArea: ca, scales } = ch;
      const h = (ch.options as { indexAxis?: string }).indexAxis === 'y';
      const sc = h ? scales.x : scales.y;
      if (!sc) return;

      const p = sc.getPixelForValue(options.value);
      ctx.save();
      ctx.strokeStyle = '#7b8ca2';
      ctx.lineWidth = 1.3;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      if (h) {
        ctx.moveTo(p, ca.top);
        ctx.lineTo(p, ca.bottom);
      } else {
        ctx.moveTo(ca.left, p);
        ctx.lineTo(ca.right, p);
      }
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = '#657990';
      ctx.font = '10.5px sans-serif';
      const t = `Avg ${Number(options.value).toLocaleString('en-US', { maximumFractionDigits: 1 })}`;
      if (h) {
        ctx.textAlign = 'center';
        ctx.fillText(t, Math.min(Math.max(p, ca.left + 24), ca.right - 24), ca.top - 3);
      } else {
        ctx.textAlign = 'right';
        ctx.fillText(t, ca.right, p - 4);
      }
      ctx.restore();
    },
  };

  // Value Labels Plugin
  const valLabelsPlugin: Plugin = {
    id: 'valLabels',
    afterDatasetsDraw(ch, _args, options) {
      if (!options || !options.show) return;
      const meta = ch.getDatasetMeta(0);
      const dataset = ch.data.datasets[0];
      const data = dataset?.data;
      if (!meta || !data) return;

      const { ctx } = ch;
      ctx.save();
      ctx.fillStyle = '#41566f';
      ctx.font = '10.5px sans-serif';
      ctx.textBaseline = 'middle';

      meta.data.forEach((bar, i) => {
        const val = data[i];
        if (val == null) return;
        const formatted = Math.round(Number(val)).toLocaleString('en-US');
        const pos = bar.tooltipPosition(true);
        if (pos && typeof pos.x === 'number' && typeof pos.y === 'number') {
          ctx.fillText(formatted, pos.x + 6, pos.y);
        }
      });
      ctx.restore();
    },
  };

  // Center Text Plugin for Doughnut Charts
  const centerTextPlugin: Plugin = {
    id: 'centerText',
    beforeDraw(ch, _args, options) {
      if (!options || !options.lines) return;
      const { ctx, chartArea: ca } = ch;
      if (!ca) return;
      const x = (ca.left + ca.right) / 2;
      const y = (ca.top + ca.bottom) / 2;

      ctx.save();
      ctx.textAlign = 'center';
      ctx.fillStyle = '#1e3551';
      ctx.font = '700 20px sans-serif';
      ctx.fillText(options.lines[0], x, y + 2);

      ctx.fillStyle = '#718198';
      ctx.font = '11px sans-serif';
      ctx.fillText(options.lines[1], x, y + 18);
      ctx.restore();
    },
  };

  ChartJS.register(avgLinePlugin, valLabelsPlugin, centerTextPlugin);
}
