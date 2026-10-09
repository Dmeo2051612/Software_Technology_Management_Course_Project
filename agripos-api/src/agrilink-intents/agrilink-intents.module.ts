import { Logger, Module } from '@nestjs/common';
import { CommunityModule } from '../community/community.module';
import { MarketplaceModule } from '../marketplace/marketplace.module';
import { AgrilinkTrustModule } from '../marketplace/agrilink-trust.module';
import { AgriReferenceModule } from '../agri-reference/agri-reference.module';
import { AgrilinkMatchingService } from './agrilink-matching.service';
import { AgrilinkIntentsController } from './agrilink-intents.controller';
import { AgrilinkIntentsService } from './agrilink-intents.service';
import { MATCH_EXPLAINER, TemplateMatchExplainer } from './explainer';
import { AiParser, INTENT_PARSER } from './parser/intent-parser';
import { LlmIntentParser } from './parser/llm-intent-parser';
import { deepseekGenerate, geminiGenerate } from './parser/llm-providers';
import { RuleIntentParser } from './parser/rule-intent-parser';

@Module({
  imports: [
    CommunityModule,
    MarketplaceModule,
    AgrilinkTrustModule,
    AgriReferenceModule,
  ],
  controllers: [AgrilinkIntentsController],
  providers: [
    AgrilinkIntentsService,
    AgrilinkMatchingService,
    RuleIntentParser,
    TemplateMatchExplainer,
    {
      provide: INTENT_PARSER,
      useFactory: (rules: RuleIntentParser) => {
        const provider = process.env.AGRILINK_AI_PROVIDER || 'rules';
        if (provider === 'rules') return rules;
        const env = process.env;
        const setups = {
          deepseek: {
            key: env.DEEPSEEK_API_KEY,
            make: (key: string, timeout: number) =>
              deepseekGenerate(
                key,
                env.DEEPSEEK_MODEL || 'deepseek-flash',
                timeout,
              ),
            limit: Number(env.DEEPSEEK_DAILY_LIMIT) || 2000,
          },
          gemini: {
            key: env.GEMINI_API_KEY,
            make: (key: string, timeout: number) =>
              geminiGenerate(
                key,
                env.GEMINI_MODEL || 'gemini-3.8-flash',
                timeout,
              ),
            limit: Number(env.GEMINI_DAILY_LIMIT) || 800,
          },
        };
        if (!(provider in setups))
          throw new Error(
            'AGRILINK_AI_PROVIDER must be rules, deepseek or gemini',
          );
        const name = provider as AiParser;
        const setup = setups[name];
        if (!setup.key) {
          // Thiếu key thì chạy bằng bộ luật, không làm sập API.
          new Logger('AgrilinkIntentsModule').warn(
            `AGRILINK_AI_PROVIDER=${name} nhưng chưa có ${name.toUpperCase()}_API_KEY — dùng bộ luật.`,
          );
          return rules;
        }
        return new LlmIntentParser(
          rules,
          setup.make(setup.key, Number(env.AGRILINK_AI_TIMEOUT_MS) || 8000),
          { name, dailyLimit: setup.limit },
        );
      },
      inject: [RuleIntentParser],
    },
    { provide: MATCH_EXPLAINER, useExisting: TemplateMatchExplainer },
  ],
})
export class AgrilinkIntentsModule {}
