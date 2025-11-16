const yargs = require('yargs');
const { hideBin } = require('yargs/helpers');
const { getConfig } = require('./config');
const { info, error } = require('./logger');
const { parseExcelFile } = require('./excelParser');
const { syncAllProductsFromExcel } = require('./productSync');

async function main() {
  const argv = yargs(hideBin(process.argv))
    .usage('Usage: $0 --file <path> [--dry-run]')
    .option('file', {
      alias: 'f',
      describe: 'Path to Excel (.xlsx) file',
      type: 'string',
      demandOption: true
    })
    .option('dry-run', {
      describe: 'Validate and show planned operations without calling Shopify',
      type: 'boolean',
      default: false
    })
    .help()
    .alias('help', 'h')
    .parse();

  const { file, dryRun } = argv;

  try {
    const config = getConfig();
    info(`Using store: ${config.storeDomain} (API ${config.apiVersion})`);

    const grouped = parseExcelFile(file);

    info('--- Excel parse summary ---');
    info(`Products (by handle): ${grouped.productsByHandle.size}`);
    info(`Products with images: ${grouped.imagesByHandle.size}`);
    info(`Products with metafields: ${grouped.metafieldsByHandle.size}`);
    info(`Dry run: ${dryRun ? 'YES' : 'NO'}`);

    await syncAllProductsFromExcel(grouped, { dryRun });
  } catch (err) {
    error(err.message);
    process.exit(1);
  }
}

main();
