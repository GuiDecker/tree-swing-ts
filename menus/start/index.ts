import {
  chooseOption,
  handleUpdateOptionsMenu,
  initMenu,
} from "../../core/input/menu";
import { $ } from "bun";
import { showCursor } from "../../core/terminal/cursor";
import { renderColor } from "../../core/input/text";
import { COLORS } from "../../core/terminal/colors";
import { ConfigService } from "../../services/configService";
import { showConfigManager } from "../configManager";
import { showSyncBranches } from "../syncBranches";
import { makeQuestion } from "../../core/input/question";

const currentOption = 1;

export const showMenuStart = () => {
  initMenu();

  const menuOptions = ConfigService.getConfig();

  const syncOption = {
    id: menuOptions.length + 1,
    label: "🔄 Sync child branches",
    value: "sync",
  };
  const otherOption = {
    id: menuOptions.length + 2,
    label: "other",
    value: "other",
    isGoBack: true,
  };

  const options = [
    ...menuOptions.map((option) => ({
      ...option,
      action: handleCreateNewBranch(option.value, option.label),
    })),
    { ...syncOption, action: handleSync },
    { ...otherOption, action: handleOther },
  ];

  chooseOption(currentOption, [...menuOptions, syncOption, otherOption]);
  process.stdin.on("data", handleUpdateOptionsMenu(currentOption, options));
};

const handleSync = () => {
  process.stdin.removeAllListeners("data");
  showSyncBranches();
};

const handleOther = () => {
  process.stdin.removeAllListeners("data");
  showConfigManager();
};

const handleCreateNewBranch = (prefix: string, branch: string) => async () => {
  const currentBranch = (
    await $`git rev-parse --abbrev-ref HEAD`.text()
  ).trim();

  if (currentBranch.includes(prefix)) {
    process.stdout.write(renderColor(`⚠️  The current branch:`, COLORS.YELLOW));
    process.stdout.write(
      renderColor(` ${currentBranch}\n`, [COLORS.BOLD, COLORS.MAGENTA]),
    );
    process.stdout.write(
      renderColor(`Already includes the prefix`, COLORS.YELLOW),
    );
    process.stdout.write(
      renderColor(` ${prefix}\n\n`, [COLORS.BOLD, COLORS.MAGENTA]),
    );
    process.stdout.write(
      renderColor(
        `❌ Please switch to a branch that doesn't include the prefix "${prefix}" before running this tool.\n`,
        COLORS.RED,
      ),
    );

    showCursor();
    process.exit(0);
  }

  process.stdout.write(
    renderColor("⏳ Fetching and preparing...\n", COLORS.CYAN),
  );

  try {
    await $`git switch ${branch}`.quiet();
  } catch {
    process.stdout.write(
      renderColor(
        `⚠️  Failed to enter into branch "${branch}". Please check if it exists on the remote.\n`,
        COLORS.RED,
      ),
    );
    showCursor();
    process.exit(0);
  }

  try {
    await $`git pull origin ${branch}`.quiet();
  } catch {
    process.stdout.write(
      renderColor(
        `⚠️  Failed to update branch "${branch}". Please check if it exists on the remote.\n`,
        COLORS.RED,
      ),
    );
    showCursor();
    process.exit(0);
  }

  const newBranch = `${prefix}/${currentBranch}`;
  process.stdout.write(renderColor(`📌 New branch: \n`, COLORS.GREEN));
  process.stdout.write(renderColor(`   ${newBranch}\n\n`, COLORS.DIM));

  process.stdout.write(
    renderColor("🗑️  Cleaning up old branch...\n", COLORS.GREEN),
  );
  try {
    await $`git branch -D "${newBranch}"`.quiet();
    process.stdout.write(
      renderColor(`✅ Old branch "${newBranch}" deleted.\n\n`, COLORS.DIM),
    );
  } catch {
    process.stdout.write(
      renderColor(`⚠️ No existing branch to delete.\n\n`, COLORS.DIM),
    );
  }

  process.stdout.write(
    renderColor("🔀 Switching to new branch...\n", COLORS.GREEN),
  );
  await $`git switch -c "${newBranch}"`.quiet();
  process.stdout.write(
    renderColor(`✅ Switched to new branch "${newBranch}".\n\n`, COLORS.DIM),
  );

  process.stdout.write(
    renderColor(`🔗 Merging origin/${branch}...\n`, COLORS.GREEN),
  );
  try {
    await $`git merge "origin/${currentBranch}"`.quiet();
    process.stdout.write(
      renderColor("✅ Success!\n", [COLORS.BOLD, COLORS.GREEN]),
    );
  } catch {
    process.stdout.write(
      renderColor(
        `⚠️  Merge conflicts detected. Please resolve them manually.\n`,
        COLORS.RED,
      ),
    );
    showCursor();
    process.exit(0);
  }

  process.stdout.write("\n\n");

  makeQuestion("Did you like to open the PR now? (y/n)").then(
    async (answer) => {
      if (answer.toLowerCase() === "y") {
        process.stdout.write(
          renderColor(
            `🔗 Opening PR for branch "${newBranch}"...\n`,
            COLORS.GREEN,
          ),
        );

        await $`gh pr create --base ${branch} --head ${newBranch} --title "${newBranch}" --body "Auto-created PR for ${newBranch}"`;

        process.stdout.write(
          renderColor(`✅ PR opened successfully!\n`, [
            COLORS.BOLD,
            COLORS.GREEN,
          ]),
        );
      }

      process.stdout.write(renderColor(`👋 Goodbye!\n`, COLORS.CYAN));

      showCursor();
      process.exit(0);
    },
  );
};
