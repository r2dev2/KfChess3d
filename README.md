# KfChess 3D

Kung Fu Chess in 3D.

[Play here](https://r2dev2.github.io/KfChess3d)

![demo picture](https://i.imgur.com/J2nOtr3.png)

## Description

Kung Fu chess is chess without turns. Players may move unlimited pieces at the same time and each piece has a cooldown after it finishes its move. We implement this game but in 3d.

## Controls

Keybinds:

| Key      | Function            | 
|----------|---------------------|
| `w`      | move view forward   |
| `a`      | move view left      |
| `s`      | move view right     |
| `d`      | move view backward  |
| `z`      | move view down      |
| `space`  | move view up        |
| `ctrl+j` | copy game link      |
| `ctrl+0` | reset game          |
| `ctrl+1` | switch to white POV |
| `ctrl+2` | switch to black POV |

One may use the mouse to click and drag on surroundings to rotate camera.

To move a piece, click on the square the piece is on. It can be visually confirmed that the correct piece is selected by the piece rotating. After clicking on the square the piece is on, click on the destination square to move to.

After your first click on the page, the background sound will start playing (credit to https://www.kfchess.com/ for the music).

## Developers

This is a CS174A project developed by Group 14.

| Developer      | Tasks                                            |
|----------------|--------------------------------------------------|
| Ronak Badhe    | Mouse Picking, Networking, Modifying Obj files   |
| Paurush Pandey | Collision Detection, Background, Piece Rendering |
| Joe Lin        | Piece Rendering, Move Cooldown, Bugfixing        |
| Michael Song   | Game Logic, Bugfixing                            |

This project's only code dependency is [tinygraphics](https://github.com/encyclopedia-of-code/tiny-graphics-js).
