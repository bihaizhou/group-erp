import {
  defineAppConfig,
  envString,
  type AppConfigFactory,
} from '@nocobase/app-server/config';

const people: AppConfigFactory<{ timeZone: string }> = defineAppConfig({
  defaults: { timeZone: 'Asia/Shanghai' },
  env: {
    ERP_PEOPLE_TIME_ZONE: envString('timeZone', {
      description:
        'IANA timezone for personnel effective dates, headcount and workforce planning.',
    }),
  },
});
export default people;
