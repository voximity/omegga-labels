# omegga-labels

This plugin allows players to add "labels" to bricks. You can assign custom messages to bricks and they will display their text when clicked with the Interact component.

## Install

`omegga install gh:voximity/label`

Please be sure to configure the plugin to your liking in the Omegga web UI plugin panel.

## Usage

#### Commands for everyone

- `/labels add <text>` Add a new label with the given text.
- `/labels remove` Remove a label.
- `/labels display <mode>` Change the display mode of a label.
- `/labels move` Move a label from one brick to another.
- `/labels copy` Copy a label from one brick to another.

#### Commands for specifically authorized people

- `/labels check` Remove all labels that are no longer assigned to bricks.
- `/labels reset` Remove all labels.
- `/labels export [file]` Export the labels to the file name passed or `labels.json`.
- `/labels import [file]` Import labels from the file name passed or `labels.json`.

## Credits

- voximity - creator and maintainer
- remanedur - plugin idea
