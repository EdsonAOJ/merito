import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { json, text, urlencoded } from 'express';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    rawBody: true,
    bodyParser: false,
  });
  app.enableShutdownHooks();

  app.use(json({ limit: '100kb' }));
  app.use(urlencoded({ extended: true }));
  app.use(text({ type: 'text/csv', limit: '64kb' }));

  await app.listen(process.env.PORT ?? 3000);

  app.use(
    text({
      type: 'text/csv',
      limit: '64kb',
    }),
  );
}

bootstrap().catch((error: unknown) => {
  console.error('Failed to start application', error);
  process.exitCode = 1;
});
