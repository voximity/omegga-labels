import { promises as fs } from 'fs';
import OmeggaPlugin, {
  Brick,
  BrickInteraction,
  BrsV10,
  OL,
  OmeggaPlayer,
  PC,
  PS,
  Vector,
} from 'omegga';

const { red, cyan, yellow, bold } = OMEGGA_UTIL.chat;

type Player = { id: string; name: string };
type Config = {
  allowAll: boolean;
  auth: Player[];
  banned: Player[];
  maxLabels: number;
};
type Storage = { labels: { [pos: string]: Label } };

type LabelDestination = 'middle' | 'chat';
type Label = {
  text: string;
  owner: Player;
  dest?: LabelDestination;
};

function arrEq<T>(a: T[], b: T[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export default class Plugin implements OmeggaPlugin<Config, Storage> {
  omegga: OL;
  config: PC<Config>;
  store: PS<Storage>;
  labels: Storage['labels'];
  interactPromises: { [id: string]: (interaction: BrickInteraction) => void };

  constructor(omegga: OL, config: PC<Config>, store: PS<Storage>) {
    this.omegga = omegga;
    this.config = config;
    this.store = store;
    this.interactPromises = {};
  }

  isAuthed(player: OmeggaPlayer): boolean {
    return (
      player.isHost() || this.config.auth.find(a => a.id === player.id) != null
    );
  }

  canUseLabels(player: OmeggaPlayer): boolean {
    return (
      (this.config.allowAll || this.isAuthed(player)) &&
      !this.config.banned.find(a => a.id === player.id)
    );
  }

  playerLabels(player: OmeggaPlayer): number {
    return Object.entries(this.labels).filter(
      ([p, l]) => l.owner.id === player.id
    ).length;
  }

  async updateLabels() {
    await this.store.set('labels', this.labels);
  }

  waitForInteraction(player: OmeggaPlayer): Promise<BrickInteraction> {
    return new Promise((resolve, reject) => {
      this.interactPromises[player.id] = resolve;
      setTimeout(() => reject('Timed out'), 30 * 1000);
    });
  }

  async getInteractionAndBrick(
    player: OmeggaPlayer,
    extents?: Vector
  ): Promise<{
    interaction: BrickInteraction;
    data?: BrsV10;
    brick?: Brick;
  } | null> {
    const interaction = await this.waitForInteraction(player);
    const data = await this.omegga.getSaveData({
      center: interaction.position,
      extent: extents ?? [100, 100, 100],
    });
    if (data.version !== 10) return;
    return {
      interaction,
      data,
      brick: (data.bricks as Brick[]).find(b =>
        arrEq(b.position, interaction.position)
      ),
    };
  }

  async init() {
    this.labels = await this.store.get('labels');
    if (!this.labels) {
      this.labels = {};
      await this.updateLabels();
    }

    this.omegga.on(
      'cmd:labels',
      async (speaker: string, subcommand: string, ...args: string[]) => {
        try {
          const player = this.omegga.getPlayer(speaker);

          if (subcommand === 'add') {
            // Add a new label
            const text = args.join(' ');
            if (text.length === 0) {
              this.omegga.whisper(
                player,
                red('Please specify a message to put in the label!')
              );
              return;
            }

            this.omegga.whisper(
              player,
              'Please interact with the brick you want to add a label to. It must have the <b>Interact</> component.'
            );
            const {
              interaction: { position },
              data,
              brick,
            } = await this.getInteractionAndBrick(player);
            if (!brick) {
              this.omegga.whisper(player, red('Please use a smaller brick!'));
              return;
            }

            let label = this.labels[position.toString()];
            if (label) {
              // A label already exists here
              if (label.owner.id !== player.id) {
                this.omegga.whisper(
                  player,
                  red('Another user already has a label here!')
                );
                return;
              }

              // update the label
              label.text = text;
              await this.updateLabels();
              this.omegga.whisper(
                player,
                yellow('That label has been updated.')
              );
              return;
            }

            if (
              !this.isAuthed(player) &&
              (brick.owner_index === 0 ||
                data.brick_owners[brick.owner_index - 1].id !== player.id)
            ) {
              this.omegga.whisper(
                player,
                red("You cannot put a label on another player's brick!")
              );
              return;
            }

            if (
              this.config.maxLabels !== 0 &&
              this.playerLabels(player) >= this.config.maxLabels
            ) {
              this.omegga.whisper(
                player,
                red(
                  'You have placed the maximum number of labels! Remove some to add a new one.'
                )
              );
              return;
            }

            // create the label
            this.labels[brick.position.toString()] = {
              text,
              owner: { id: player.id, name: player.name },
            };
            await this.updateLabels();
            this.omegga.whisper(player, yellow('The label has been created.'));
            console.log(player.name, 'created a label at', brick.position);
          } else if (subcommand === 'remove') {
            // Remove a label
            this.omegga.whisper(
              player,
              'Click the label brick to remove its label.'
            );
            const interaction = await this.waitForInteraction(player);
            const posKey = interaction.position.toString();
            const label = this.labels[posKey];

            if (!label) {
              this.omegga.whisper(
                player,
                red(
                  "That brick doesn't have a label assigned! Make sure it is the original size."
                )
              );
              return;
            }

            if (label.owner.id !== player.id && !this.isAuthed(player)) {
              this.omegga.whisper(
                player,
                red("You can't remove a label that isn't yours!")
              );
              return;
            }

            delete this.labels[posKey];
            await this.updateLabels();
            this.omegga.whisper(player, yellow('The label has been removed.'));
          } else if (subcommand === 'check') {
            // Check the save for labels with missing bricks
            if (!this.isAuthed(player)) return;

            if (args[0] !== 'yes') {
              this.omegga.whisper(
                player,
                red(
                  bold(
                    'Are you sure you want to check and remove invalid labels? ' +
                      'This will remove all labels that do not align with bricks. ' +
                      'Be sure you run this command on the same map you made the labels. ' +
                      "If you wish to proceed, pass 'yes' to this command."
                  )
                )
              );
            } else {
              const data = await this.omegga.getSaveData();
              const labels = Object.entries(this.labels);
              const brickSet = new Set<string>();
              for (const { position } of data.bricks) {
                brickSet.add(position.toString());
              }
              let count = 0;
              for (const [position] of labels) {
                if (!brickSet.has(position.toString())) {
                  count++;
                  delete this.labels[position];
                }
              }
              await this.updateLabels();
              this.omegga.whisper(
                player,
                yellow(`Removed ${bold(count + ' invalid labels')}.`)
              );
            }
          } else if (subcommand === 'display') {
            const mode = args[0] as LabelDestination;
            if (mode !== 'middle' && mode !== 'chat') {
              this.omegga.whisper(
                player,
                red(
                  `Please pass either ${cyan('yellow')} or ${cyan(
                    'chat'
                  )} for a display mode.`
                )
              );
              return;
            }
            this.omegga.whisper(
              player,
              "Click the label brick whose display you want to change to '" +
                mode +
                "'."
            );
            const interaction = await this.waitForInteraction(player);
            const posKey = interaction.position.toString();
            const label = this.labels[posKey];

            if (!label) {
              this.omegga.whisper(
                player,
                red(
                  "That brick doesn't have a label assigned! Make sure it is the original size."
                )
              );
              return;
            }

            if (label.owner.id !== player.id && !this.isAuthed(player)) {
              this.omegga.whisper(
                player,
                red("You can't edit a label that isn't yours!")
              );
              return;
            }

            label.dest = mode;
            await this.updateLabels();
            this.omegga.whisper(
              player,
              yellow(
                "Updated the label's display destination to '" + mode + "'."
              )
            );
          } else if (subcommand === 'reset') {
            // Reset all labels
            if (!this.isAuthed(player)) return;

            if (args[0] !== 'yes') {
              this.omegga.whisper(
                player,
                red(
                  bold(
                    "Are you sure you want to reset all labels? This cannot be undone. If so, pass 'yes' to this command."
                  )
                )
              );
            } else {
              this.labels = {};
              await this.updateLabels();
              this.omegga.whisper(player, yellow('Reset all labels.'));
            }
          } else if (subcommand === 'move') {
            this.omegga.whisper(
              player,
              '1) Interact with the brick whose label you want to move from.'
            );

            const brickA = await this.getInteractionAndBrick(player);
            const brickAPos = brickA.interaction.position.toString();
            if (!this.labels[brickAPos]) {
              this.omegga.whisper(
                player,
                red(`That brick does not have a label on it!`)
              );
              return;
            }

            if (
              this.labels[brickAPos].owner.id !== player.id &&
              !this.isAuthed(player)
            ) {
              this.omegga.whisper(
                player,
                red("You can't move a label that isn't yours!")
              );
              return;
            }

            this.omegga.whisper(
              player,
              '2) Now interact with the brick whose label you want to move to.'
            );

            const brickB = await this.getInteractionAndBrick(player);
            const brickBPos = brickB.interaction.position.toString();
            if (this.labels[brickBPos]) {
              this.omegga.whisper(
                player,
                red(`That brick has a label on it! Please remove it first.`)
              );
              return;
            }

            if (
              !this.isAuthed(player) &&
              brickB.data.brick_owners[brickB.brick.owner_index].id !==
                player.id
            ) {
              this.omegga.whisper(
                player,
                red(`You cannot move a label to a brick that is not yours!`)
              );
              return;
            }

            this.labels[brickBPos] = this.labels[brickAPos];
            delete this.labels[brickAPos];
            await this.updateLabels();
            this.omegga.whisper(player, yellow(`The label has been moved.`));
          } else if (subcommand === 'copy') {
            this.omegga.whisper(
              player,
              '1) Interact with the brick whose label you want to copy.'
            );

            const brickA = await this.getInteractionAndBrick(player);
            const brickAPos = brickA.interaction.position.toString();
            if (!this.labels[brickAPos]) {
              this.omegga.whisper(
                player,
                red(`That brick does not have a label on it!`)
              );
              return;
            }

            this.omegga.whisper(
              player,
              '2) Now interact with the brick whose label you want to copy to.'
            );

            const brickB = await this.getInteractionAndBrick(player);
            const brickBPos = brickB.interaction.position.toString();
            if (this.labels[brickBPos]) {
              this.omegga.whisper(
                player,
                red(`That brick has a label on it! Please remove it first.`)
              );
              return;
            }

            if (
              !this.isAuthed(player) &&
              brickB.data.brick_owners[brickB.brick.owner_index].id !==
                player.id
            ) {
              this.omegga.whisper(
                player,
                red(`You cannot copy a label to a brick that is not yours!`)
              );
              return;
            }

            this.labels[brickBPos] = this.labels[brickAPos];
            await this.updateLabels();
            this.omegga.whisper(player, yellow(`The label has been copied.`));
          } else if (subcommand === 'export') {
            // Export to `labels.json` or whatever was provided
            if (!this.isAuthed(player)) return;

            let dest = args.join(' ');
            if (!dest || dest.length === 0) dest = 'labels.json';
            await fs.writeFile(dest, JSON.stringify(this.labels, null, 2));
            this.omegga.whisper(
              player,
              yellow(`Exported labels to ${cyan(dest)}.`)
            );
          } else if (subcommand === 'import') {
            // Import from `labels.json` or whatever was provided
            if (!this.isAuthed(player)) return;

            const [confirm, ...rest] = args;
            if (confirm !== 'yes') {
              const restString = [confirm, ...rest].join(' ');
              this.omegga.whisper(
                player,
                red(
                  'This action will overwrite all existing labels. If you are positive, run <code>/labels import yes' +
                    (restString.length !== 0 ? ' ' + restString : '') +
                    '</>.'
                )
              );
            } else {
              let dest = rest.join(' ');
              if (!dest || dest.length === 0) dest = 'labels.json';
              try {
                this.labels = JSON.parse(
                  await (await fs.readFile(dest)).toString()
                );
                await this.updateLabels();
                this.omegga.whisper(
                  player,
                  yellow(`Imported labels from ${cyan(dest)}.`)
                );
              } catch (e) {
                this.omegga.whisper(
                  player,
                  red(`An error occurred while importing from ${cyan(dest)}.`)
                );
              }
            }
          } else {
            this.omegga.whisper(
              player,
              red(`Unknown labels command <code>${subcommand}</>.`)
            );
          }
        } catch (e) {
          if (e === 'Timed out') {
            this.omegga.whisper(
              speaker,
              red(
                'You did not interact with a brick in time. Please try again.'
              )
            );
          }
          console.log('error: ' + e);
        }
      }
    );

    this.omegga.on('interact', async (interaction: BrickInteraction) => {
      if (this.interactPromises[interaction.player.id]) {
        this.interactPromises[interaction.player.id](interaction);
        delete this.interactPromises[interaction.player.id];
        return;
      }

      const label = this.labels[interaction.position.toString()];
      if (label) {
        // TODO: text formatting? fill in player name, etc.
        if (!label.dest || label.dest === 'middle')
          this.omegga.middlePrint(interaction.player.id, label.text);
        else if (label.dest === 'chat')
          this.omegga.whisper(interaction.player.id, label.text);
      }
    });

    return { registeredCommands: ['labels'] };
  }

  async stop() {}
}
