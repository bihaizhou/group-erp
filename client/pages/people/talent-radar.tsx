import { useEffect, useRef } from 'react';
import { useTranslation } from '@nocobase/i18n/client';
import * as echarts from 'echarts/core';
import { RadarChart } from 'echarts/charts';
import {
  LegendComponent,
  TooltipComponent,
  AriaComponent,
} from 'echarts/components';
import { SVGRenderer } from 'echarts/renderers';

echarts.use([
  RadarChart,
  LegendComponent,
  TooltipComponent,
  AriaComponent,
  SVGRenderer,
]);
export function TalentRadar({
  items,
}: {
  items: { name: string; score: number; target: number | null }[];
}) {
  const ref = useRef<HTMLDivElement>(null),
    { t, i18n } = useTranslation();
  useEffect(() => {
    const element = ref.current;
    if (!element || items.length < 3) return;
    const chart = echarts.init(element, undefined, { renderer: 'svg' });
    const update = () => {
      const css = getComputedStyle(element);
      const token = (key: string) => css.getPropertyValue(key).trim();
      const foreground = token('--foreground'),
        border = token('--border'),
        primary = token('--chart-1'),
        secondary = token('--chart-2');
      chart.setOption(
        {
          animation: false,
          aria: { enabled: true },
          textStyle: { color: foreground, fontFamily: css.fontFamily },
          legend: {
            bottom: 0,
            textStyle: { color: foreground },
            data: [
              t('people.employeeScore'),
              ...(items.every((v) => v.target !== null)
                ? [t('people.modelTarget')]
                : []),
            ],
          },
          tooltip: { trigger: 'item', renderMode: 'richText' },
          radar: {
            radius: element.clientWidth < 360 ? '48%' : '60%',
            center: ['50%', '44%'],
            indicator: items.map((v) => ({
              name:
                element.clientWidth < 360 && v.name.length > 4
                  ? `${v.name.slice(0, 4)}\n${v.name.slice(4)}`
                  : v.name,
              max: 5,
              min: 0,
            })),
            axisName: { color: foreground },
            axisLine: { lineStyle: { color: border } },
            splitLine: { lineStyle: { color: border } },
            splitArea: { show: false },
          },
          series: [
            {
              type: 'radar',
              data: [
                {
                  name: t('people.employeeScore'),
                  value: items.map((v) => v.score),
                  lineStyle: { color: primary },
                  itemStyle: { color: primary },
                  areaStyle: { color: primary, opacity: 0.12 },
                },
                ...(items.every((v) => v.target !== null)
                  ? [
                      {
                        name: t('people.modelTarget'),
                        value: items.map((v) => v.target),
                        lineStyle: { color: secondary, type: 'dashed' },
                        itemStyle: { color: secondary },
                        symbol: 'none',
                      },
                    ]
                  : []),
              ],
            },
          ],
        },
        true,
      );
      chart.resize();
    };
    update();
    const resize = new ResizeObserver(update);
    resize.observe(element);
    const theme = new MutationObserver(update);
    theme.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'style', 'data-theme', 'data-color-scheme'],
    });
    return () => {
      theme.disconnect();
      resize.disconnect();
      chart.dispose();
    };
  }, [items, t, i18n.language]);
  return (
    <div
      ref={ref}
      className='aspect-square w-full'
      role='img'
      aria-label={t('people.radarDescription')}
    />
  );
}
