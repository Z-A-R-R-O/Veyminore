/**
 * @file anthropic.js
 * Anthropic Claude adapter for ZETRO Universal Agent 2.0.
 *
 * Supports Anthropic Computer Use protocol (Claude 3.5 Sonnet / 3.7 Sonnet)
 * as well as discrete tool calling.
 */

import {
  createModelProviderPort,
  AdapterTranslationError,
  ProviderTimeoutError
} from '../contracts/model-provider.js';
import {
  compileAnthropicTools,
  parseAnthropicComputerAction,
  parseStructuredJsonAction
} from './schema-compiler.js';

/**
 * Creates an Anthropic ModelProviderPort.
 *
 * @param {Object} options
 * @param {string} [options.id]
 * @param {string} [options.endpoint='https://api.anthropic.com/v1']
 * @param {string} options.model - e.g. "claude-3-5-sonnet-20241022"
 * @param {string} [options.apiKey='']
 * @param {number} [options.displayWidth=1920]
 * @param {number} [options.displayHeight=1080]
 * @param {boolean} [options.nativeComputerUse=true]
 * @param {Object} [options.capabilities]
 * @param {number} [options.timeoutMs=45000]
 * @param {Function} [options.fetchFn=globalThis.fetch]
 * @returns {import('../contracts/model-provider.js').ModelProviderPort}
 */
export function createAnthropicAdapter({
  id,
  endpoint = 'https://api.anthropic.com/v1',
  model,
  apiKey = '',
  displayWidth = 1920,
  displayHeight = 1080,
  nativeComputerUse = true,
  capabilities = {},
  timeoutMs = 45000,
  fetchFn = globalThis.fetch
}) {
  if (!model || typeof model !== 'string') {
    throw new Error("createAnthropicAdapter requires a string 'model'");
  }

  const baseUrl = endpoint.replace(/\/+$/, '');
  const providerId = id || `anthropic-${model}`;

  return createModelProviderPort({
    profile: {
      id: providerId,
      provider: 'anthropic',
      model,
      endpoint: baseUrl,
      capabilities: {
        vision: 'verified',
        toolCalling: 'verified',
        nativeComputerUse: nativeComputerUse ? 'verified' : 'unsupported',
        ...capabilities
      }
    },
    proposeActionImpl: async ({ prompt, messages = [], screenshotBuffer, mimeType = 'image/png' }) => {
      const messagesEndpoint = `${baseUrl}/messages`;
      const tools = compileAnthropicTools({ displayWidth, displayHeight, nativeComputerUse });

      const formattedMessages = [];

      // Pass conversation history
      for (const msg of messages) {
        formattedMessages.push(msg);
      }

      // Build current user message content blocks
      const contentBlocks = [];

      // Multimodal vision block
      if (screenshotBuffer) {
        const base64Image = Buffer.isBuffer(screenshotBuffer)
          ? screenshotBuffer.toString('base64')
          : String(screenshotBuffer);
        contentBlocks.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: mimeType,
            data: base64Image
          }
        });
      }

      if (prompt) {
        contentBlocks.push({
          type: 'text',
          text: prompt
        });
      }

      formattedMessages.push({
        role: 'user',
        content: contentBlocks
      });

      const body = {
        model,
        max_tokens: 1024,
        system: 'You are ZETRO, an autonomous computer agent with full control over the desktop. Take precise actions to complete the user goal.',
        messages: formattedMessages,
        tools
      };

      const headers = {
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01'
      };

      if (nativeComputerUse) {
        headers['anthropic-beta'] = 'computer-use-2024-10-22';
      }

      if (apiKey) {
        headers['x-api-key'] = apiKey;
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      let response;
      try {
        response = await fetchFn(messagesEndpoint, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal: controller.signal
        });
      } catch (err) {
        if (err.name === 'AbortError') {
          throw new ProviderTimeoutError(providerId, timeoutMs);
        }
        throw new AdapterTranslationError(providerId, `Network error connecting to Anthropic endpoint: ${err.message}`);
      } finally {
        clearTimeout(timer);
      }

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        throw new AdapterTranslationError(providerId, `Anthropic API error (${response.status}): ${errorText}`);
      }

      const json = await response.json();
      const content = json.content;
      if (!Array.isArray(content) || content.length === 0) {
        throw new AdapterTranslationError(providerId, 'Anthropic model returned empty content array');
      }

      // Look for tool_use block
      const toolUse = content.find(block => block.type === 'tool_use');
      if (toolUse) {
        try {
          const action = parseAnthropicComputerAction(toolUse);
          return {
            action,
            raw: json,
            usage: {
              promptTokens: json.usage?.input_tokens,
              completionTokens: json.usage?.output_tokens
            }
          };
        } catch (err) {
          throw new AdapterTranslationError(providerId, `Failed to parse Anthropic tool use: ${err.message}`, toolUse);
        }
      }

      // Look for text block containing structured JSON or text
      const textBlock = content.find(block => block.type === 'text');
      if (textBlock && textBlock.text) {
        try {
          const action = parseStructuredJsonAction(textBlock.text);
          return {
            action,
            raw: json,
            usage: {
              promptTokens: json.usage?.input_tokens,
              completionTokens: json.usage?.output_tokens
            }
          };
        } catch {
          throw new AdapterTranslationError(providerId, `Anthropic replied with text without tool invocation: ${textBlock.text.slice(0, 100)}...`, textBlock.text);
        }
      }

      throw new AdapterTranslationError(providerId, 'Anthropic response contained no actionable tool_use or content', json);
    },

    testConnectionImpl: async () => {
      // Lightweight models query or ping
      const modelsEndpoint = `${baseUrl}/models`;
      const headers = {
        'anthropic-version': '2023-06-01'
      };
      if (apiKey) {
        headers['x-api-key'] = apiKey;
      }

      const start = Date.now();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10000);

      try {
        const res = await fetchFn(modelsEndpoint, {
          method: 'GET',
          headers,
          signal: controller.signal
        });
        const latencyMs = Date.now() - start;
        return {
          ok: res.ok,
          latencyMs,
          status: res.status
        };
      } catch (err) {
        return {
          ok: false,
          error: err.message
        };
      } finally {
        clearTimeout(timer);
      }
    }
  });
}
