import { ID } from '../api-client/common';
import { loadSourceCode } from './internal/file-loaders';
import { getGlobalScrapboxApi } from './internal/setup-api';
import { validateToken } from './internal/validation';

const findIndex = (searchString: string, lines: { text: string }[]) => {
  return lines.findIndex((line) => line.text.includes(searchString));
};
const findNextLineId = (searchString: string, lines: { id: ID; text: string }[]): ID | null => {
  const index = findIndex(searchString, lines);
  if (index === -1) {
    return null;
  }
  const nextLineOrNone = lines[index + 1];

  return nextLineOrNone ? nextLineOrNone.id : null;
};

type DeployConfig = {
  projectName: string;
  targetPageName: string;
  codeBlockLabel: string;
  sourceFilePath: string;
};

const deploySinglePage = async (token: string, config: DeployConfig) => {
  const sourceCode = await loadSourceCode(config.sourceFilePath);
  const api = await getGlobalScrapboxApi(config.projectName, config.token);
  const page = await api.getPage(config.targetPageName);

  // NOTE: assuming code-block exists already
  const lineId = findNextLineId(config.codeBlockLabel, page.lines);
  if (!lineId) {
    throw new Error('Line not found');
  }
  await api.changeLine(config.targetPageName, { type: 'update', id: lineId, text: sourceCode });
};

export const deploy = async (token: string, configs: DeployConfig[]) => {
  console.log(`[scrapbox-tools/deploy] script started`);

  try {
    validateToken(token);
  } catch (e) {
    console.error('[scrapbox-tools/deploy] token is invalid');
    process.exit(1);
  }

  const deployTasks = configs.map((config) => {
    const taskName = `${config.projectName}/${config.targetPageName}/${config.codeBlockLabel}`;
    console.log(`[scrapbox-tools/deploy] task started: ${taskName}`);

    return deploySinglePage(token, config)
      .then(() => {
        console.log(`[scrapbox-tools/deploy] task completed: ${taskName}`);
      })
      .catch((e) => {
        console.error(`[scrapbox-tools/deploy] task errored: ${taskName}`, e);
      });
  });

  return Promise.all(deployTasks)
    .then(() => {
      console.log('[scrapbox-tools/deploy] script completed');
      process.exit();
    })
    .catch((e) => {
      console.error('[scrapbox-tools/deploy] script errored ', e);
      process.exit(1);
    });
};
