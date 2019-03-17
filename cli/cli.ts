import GDrive from '@/index';
import { options } from './cliconfig';
import * as colors from 'colors';
import mysqldump from 'mysqldump';
import * as fs from 'fs';
import * as path from 'path';
import * as moment from 'moment';
import { Schema$File$Modded } from '../src';
import Config from '../src/config';
import FileUtils from '../src/file.utils';

const theme = {
  folder: 'cyan',
  error: 'red',
};

colors.setTheme(theme);

class Cli {
  constructor(
      private opts = options,
      private gdrive = new GDrive()) {
    // console.log('OPTIONS', this.opts);
  }

  async parseOptions() {
    for (let command in this.opts) {
      const args = this.opts[command];
      const zip = this.opts['zip'];
      const folder = this.opts['folder'];
      const replace = this.opts['replace'];
      const create = this.opts['create'];
      switch (command) {
        case 'backup':
          await this.backup(args, { zip, folder, replace, create });
          break;
        case 'delete':
          await this.delete(args, folder);
          break;
        case 'mysql':
          await this.dumpMysql({ zip, folder, replace, create });
          break;
        case 'list':
          await this.showList();
          break;
      }
    }
  }

  async showList() {
    const files = (await this.gdrive.listFiles())
        .filter((file) => !file.isDeleted);
    if (files.length) {
      console.log(`${Config.TAG} File list:`);
      this.beautifulFiles(files);
    } else {
      console.log(`${Config.TAG} No files found.`);
    }
  }

  async delete(args, folder) {
    if (!Array.isArray(args)) {
      args = [args];
    }
    const parsed = args.map(this.parseDelete).map((arg) => {
      if (!arg.folder) {
        arg.folder = folder;
      }
      return {
        ...arg,
      };
    });
    for (let info of parsed) {
      const { folder, timeSpace } = info;
      await this.gdrive.cleanOlder(timeSpace, folder);
    }
  }

  async backup(
      files: string | string[],
      options: { zip: string, folder: string, replace: boolean, create: boolean },
  ) {
    const { zip, folder, replace, create } = options;
    if (!Array.isArray(files)) {
      files = [files];
    }
    await this.gdrive.uploadFiles(files, folder || false, {
      compress: zip || zip === null,
      replace,
      create,
    });
  }

  async dumpMysql(options: { zip: string, folder: string, replace: boolean, create: boolean }) {
    let mysqlfile;
    try {
      mysqlfile = await this.createDumpFile();
    } catch(err) {
      console.error(`${Config.TAG} Error mysql ${err}`['bold'][theme.error]);
      process.exit(-1);
    }
    await this.backup(mysqlfile, options);
  }

  private parseDelete(arg) {
    let folder;
    let timeSpace;
    const parsed = arg.split('=');
    if (parsed.length > 1) {
      folder = parsed[0];
      timeSpace = parsed[1];
    } else {
      timeSpace = arg;
      folder = null;
    }
    return {
      folder,
      timeSpace,
    };
  }

  private findFile(files: Schema$File$Modded[], fileId: string) {
    const result = files.find((file) => file.id === fileId);
    if (result) {
      return result.name;
    } else {
      return null;
    }
  }

  private beautifulFiles(files: Schema$File$Modded[]) {
    const parsed = files.map((file) => {
      return {
        ...file,
        parentFolder: this.findFile(files, file.parents[0]),
      };
    });
    parsed.sort(this.sortByName);
    parsed.sort(this.sortByParent);
    parsed.sort(this.sortByFolder);
    parsed.forEach((file) => {
      const fileName = file.isFolder ? this.showFolder(file.name) : file.name;
      const parent = file.parentFolder ? this.showFolder(`${file.parentFolder}/`) : '';
      console.log(parent + fileName);
    });
  }

  private sortByName(a, b) {
    if (a.name < b.name) {
      return -1;
    } else if (a.name > b.name) {
      return 1;
    }
    return 0;
  }

  private sortByFolder(a, b) {
    if (a.isFolder && !b.isFolder) {
      return -1;
    } else if (!a.isFolder && b.isFolder) {
      return 1;
    }
    return 0;
  }

  private sortByParent(a, b) {
    if ((a.parentFolder && b.parentFolder) || (!a.parentFolder && !b.parentFolder)) {
      return 0;
    } else if (!a.parentFolder && b.parentFolder) {
      return 1;
    } else {
      return -1;
    }
  }

  private showFolder(name: string) {
    return name['bold'][theme.folder];
  }

  private createDumpFile() {
    const host = process.env.MYSQL_HOST || 'localhost';
    const port = +process.env.MYSQL_PORT || 3306;
    const user = process.env.MYSQL_USER;
    const password = process.env.MYSQL_PASSWORD;
    const database = process.env.MYSQL_DATABASE;
    if (!user || !password || !database) {
      console.error(`${Config.TAG} Error in mysql-dump environment variables not defined`);
      console.error('$MYSQL_USER, $MYSQL_PASSWORD, $MYSQL_DATABASE, $MYSQL_HOST, $MYSQL_PORT');
      process.exit(-1);
    }
    return mysqldump({
      connection: {
        host,
        port,
        user,
        password,
        database,
      },
    }).then(({ dump }) => {
      const fileDest = `./files/mysqldump-${moment().format('YYYY-MM-DD.HHmmss')}.sql`;
      FileUtils.mkdirp(path.dirname(fileDest));
      const content = Object.values(dump)
          .map((result) => result.replace(/^# /gm, '-- '))
          .join('\n\n');
      fs.writeFileSync(fileDest, content);
      return fileDest;
    });
  }
}

(async () => {
  await new Cli().parseOptions();
})();