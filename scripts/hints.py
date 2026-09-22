#!/usr/bin/env python3
"""
Write the imposter hints into the pack files.

A hint is the one word you would use to describe a footballer to someone who
already knows them. It has to be true, and it has to be useless to anyone
trying to name the player from it alone: no club, no country, no shirt number,
no single famous moment. "flair", "captain", "aura".

The imposter sees only this. It should be enough to bluff with and never
enough to be sure.

    python scripts/hints.py

Rewrites src/data/*.json in place, turning each name into {name, hint}. Safe
to re-run: it reads whichever shape the files are already in.
"""
import json
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "src" / "data"

HINTS = {
    # ---------------------------------------------------------------- Premier League
    "Erling Haaland": "machine",
    "Bukayo Saka": "humble",
    "Cole Palmer": "cold",
    "Bruno Fernandes": "captain",
    "Virgil van Dijk": "aura",
    "Declan Rice": "engine",
    "Martin Ødegaard": "silk",
    "Phil Foden": "gifted",
    "Alexander Isak": "elegant",
    "Florian Wirtz": "vision",
    "Alisson Becker": "assured",
    "Gianluigi Donnarumma": "giant",
    "Jordan Pickford": "shouty",
    "Harry Maguire": "headers",
    "Jack Grealish": "showman",
    "Kai Havertz": "lanky",
    "Gabriel Jesus": "misfiring",
    "Jordan Henderson": "veteran",
    "Bruno Guimarães": "conductor",
    "Reece James": "fragile",
    "Viktor Gyökeres": "poacher",
    "Eberechi Eze": "trickster",
    "Enzo Fernández": "expensive",
    "Emiliano Martínez": "villain",
    "Bradley Barcola": "direct",
    "Sandro Tonali": "deep-lying",
    "Morgan Rogers": "unheralded",
    "Andy Robertson": "overlap",
    "Moisés Caicedo": "ball-winner",
    "William Saliba": "calm",
    "Gabriel Magalhães": "set-piece",
    "Rúben Dias": "organiser",
    "Jérémy Doku": "dribbler",
    "Omar Marmoush": "livewire",
    "Matheus Cunha": "temper",
    "Bryan Mbeumo": "underrated",
    "Benjamin Šeško": "raw",
    "Amad Diallo": "spark",
    "Mason Mount": "forgotten",
    "Kobbie Mainoo": "composed",
    "Dominic Solanke": "workhorse",
    "Richarlison": "acrobat",
    "James Maddison": "cheeky",
    "Micky van de Ven": "rapid",
    "Kaoru Mitoma": "slalom",
    "Chris Wood": "targetman",
    "Morgan Gibbs-White": "scrapper",
    "Antoine Semenyo": "powerhouse",
    "Dominik Szoboszlai": "thunderbolt",
    "Cody Gakpo": "streaky",
    "Elliot Anderson": "understated",
    "Carlos Baleba": "destroyer",
    "Iliman Ndiaye": "twinkle",
    "Savinho": "touchline",
    "Xavi Simons": "hyped",
    "Mohammed Kudus": "strong",
    "Hugo Ekitiké": "smooth",
    "Dominic Calvert-Lewin": "aerial",
    "Marc Guéhi": "steady",
    "Nick Woltemade": "towering",
    "Milos Kerkez": "relentless",
    "Jeremie Frimpong": "flying",
    "Ryan Gravenberch": "glides",
    "Rayan Cherki": "audacious",
    "Joško Gvardiol": "bulldozer",
    "Nico O'Reilly": "homegrown",
    "Martín Zubimendi": "tidy",
    "Noni Madueke": "erratic",
    "Riccardo Calafiori": "marauding",
    "Myles Lewis-Skelly": "cocky",
    "Ethan Nwaneri": "wonderkid",
    "Cristhian Mosquera": "unfazed",
    "João Pedro": "clutch",
    "Estêvão": "phenom",
    "Jamie Gittens": "burst",
    "Levi Colwill": "left-sided",
    "Leny Yoro": "promise",
    "Patrick Dorgu": "flyer",
    "Senne Lammens": "newcomer",
    "Lucas Bergvall": "grit",
    "Archie Gray": "versatile",
    "Yoane Wissa": "quiet",
    "Tino Livramento": "bursting",
    "Dan Burn": "colossus",
    "Adam Wharton": "passer",
    "Jean-Philippe Mateta": "bull",
    "Yankuba Minteh": "electric",
    "Murillo": "aggressive",
    "Granit Xhaka": "stubborn",
    "Igor Thiago": "clinical",
    "Liam Delap": "bustling",
    "Mateus Fernandes": "unassuming",
    "Ayyoub Bouaddi": "prospect",
    "Jérémy Jacquet": "unknown",
    "Maxence Lacroix": "physical",
    "Jan Paul van Hecke": "reader",
    "Jarrad Branthwaite": "beanpole",
    "Evanilson": "runner",
    "Justin Kluivert": "bloodline",
    "Bart Verbruggen": "sweeper-keeper",
    # ------------------------------------------------------------- Champions League
    "Kylian Mbappé": "lightning",
    "Jude Bellingham": "swagger",
    "Vinícius Júnior": "flair",
    "Lamine Yamal": "generational",
    "Raphinha": "workrate",
    "Harry Kane": "complete",
    "Ousmane Dembélé": "two-footed",
    "Jamal Musiala": "weaves",
    "Pedri": "orchestrator",
    "Kevin De Bruyne": "crosser",
    "Thibaut Courtois": "wall",
    "Julián Álvarez": "tireless",
    "Lautaro Martínez": "predator",
    "Trent Alexander-Arnold": "pinpoint",
    "Federico Valverde": "lungs",
    "Rodrygo": "understudy",
    "Gavi": "terrier",
    "Frenkie de Jong": "carrier",
    "Joshua Kimmich": "everywhere",
    "Luis Díaz": "smile",
    "Scott McTominay": "timing",
    "Victor Osimhen": "explosive",
    "Achraf Hakimi": "rampaging",
    "Rodri": "metronome",
    "Bernardo Silva": "nutmegs",
    "Anthony Gordon": "pest",
    "John Stones": "ball-playing",
    "Ibrahima Konaté": "quick",
    "Paul Pogba": "flamboyant",
    "Cristian Romero": "snarling",
    "Vitinha": "tiny",
    "Désiré Doué": "fearless",
    "Khvicha Kvaratskhelia": "mazy",
    "Marquinhos": "captain",
    "Nuno Mendes": "turbo",
    "João Neves": "scurrying",
    "Michael Olise": "wand",
    "Dayot Upamecano": "rash",
    "Alphonso Davies": "rocket",
    "Leroy Sané": "streaky",
    "Serge Gnabry": "cutting",
    "Aurélien Tchouaméni": "shield",
    "Eduardo Camavinga": "elastic",
    "Arda Güler": "whip",
    "Antonio Rüdiger": "menace",
    "Jules Koundé": "dapper",
    "Dani Olmo": "clever",
    "Ferran Torres": "willing",
    "Nicolò Barella": "fiery",
    "Hakan Çalhanoğlu": "dead-ball",
    "Marcus Thuram": "bloodline",
    "Alessandro Bastoni": "cultured",
    "Kenan Yıldız": "heir",
    "Dušan Vlahović": "brooding",
    "Marc-André ter Stegen": "shot-stopper",
    "Denzel Dumfries": "galloping",
    "Karim Adeyemi": "blistering",
    "Randal Kolo Muani": "gangly",
    "Rasmus Højlund": "patient",
    "Curtis Jones": "tidy",
    "Dean Huijsen": "composed",
    "Álvaro Carreras": "overlapping",
    "Franco Mastantuono": "prodigy",
    "Fermín López": "energy",
    "Marc Casadó": "unfussy",
    "Alejandro Balde": "nippy",
    "Joan García": "reflexes",
    "Pau Cubarsí": "mature",
    "Marcos Llorente": "engine",
    "Pablo Barrios": "combative",
    "Giuliano Simeone": "running",
    "Jan Oblak": "veteran",
    "Alexander Sørloth": "towering",
    "Alejandro Grimaldo": "whipped",
    "Morten Hjulmand": "anchor",
    "Lee Kang-in": "crafty",
    "Yan Diomande": "raw",
    "Jonathan Tah": "imposing",
    "Aleksandar Pavlović": "neat",
    "Lennart Karl": "fledgling",
    "Ismael Saibari": "box-to-box",
    "Jobe Bellingham": "shadow",
    "Serhou Guirassy": "prolific",
    "Nico Schlotterbeck": "adventurous",
    "Patrik Schick": "finisher",
    "Illia Zabarnyi": "stoic",
    "Lucas Chevalier": "newcomer",
    "Warren Zaïre-Emery": "precocious",
    "Senny Mayulu": "emerging",
    "Federico Dimarco": "curler",
    "Yann Sommer": "agile",
    "Strahinja Pavlović": "rugged",
    "Alessandro Buongiorno": "dependable",
    "Matteo Politano": "inverted",
    "Vangelis Pavlidis": "poacher",
    "Samu Aghehowa": "rising",
    "Pedro Gonçalves": "understated",
    "Barış Alper Yılmaz": "bustling",
    "Ricardo Pepi": "super-sub",
    "Mika Biereth": "hat-tricks",
    # ------------------------------------------------------------- World Cup Heroes
    "Pelé": "immortal",
    "Diego Maradona": "genius",
    "Lionel Messi": "inevitable",
    "Cristiano Ronaldo": "relentless",
    "Zinedine Zidane": "pirouette",
    "Ronaldo Nazário": "unstoppable",
    "Ronaldinho": "joy",
    "David Beckham": "whipped",
    "Thierry Henry": "gliding",
    "Wayne Rooney": "bulldog",
    "Neymar": "theatrical",
    "Luka Modrić": "maestro",
    "Andrés Iniesta": "ghost",
    "Xavi": "tempo",
    "Franz Beckenbauer": "sweeper",
    "Johan Cruyff": "philosopher",
    "Bobby Moore": "composure",
    "Gary Lineker": "poacher",
    "Paolo Maldini": "timeless",
    "Roberto Baggio": "melancholy",
    "Gianluigi Buffon": "longevity",
    "Iker Casillas": "reflexes",
    "Miroslav Klose": "efficient",
    "Kaká": "gallop",
    "Cafu": "overlapping",
    "Roberto Carlos": "thunderbolt",
    "Michael Owen": "burst",
    "Lothar Matthäus": "driving",
    "Gerd Müller": "box",
    "Marco van Basten": "volley",
    "Zico": "free-kicks",
    "Sócrates": "thinker",
    "Romário": "sly",
    "Rivaldo": "languid",
    "Michel Platini": "elegant",
    "Eusébio": "explosive",
    "Bobby Charlton": "statesman",
    "Geoff Hurst": "clinical",
    "Gordon Banks": "unbeatable",
    "Paul Gascoigne": "mercurial",
    "Alan Shearer": "brutal",
    "Steven Gerrard": "thunder",
    "Frank Lampard": "arriving",
    "Fabio Cannavaro": "leader",
    "Andrea Pirlo": "serene",
    "Francesco Totti": "loyal",
    "Alessandro Del Piero": "curler",
    "Philipp Lahm": "reliable",
    "Bastian Schweinsteiger": "warrior",
    "Thomas Müller": "awkward",
    "Manuel Neuer": "commanding",
    "Lilian Thuram": "unlikely",
    "Patrick Vieira": "towering",
    "Didier Drogba": "force",
    "Samuel Eto'o": "sharp",
    "Antoine Griezmann": "cheeky",
    "Ángel Di María": "finals",
    "Garrincha": "dribbler",
    "Jairzinho": "hurricane",
    "Carlos Alberto": "thunderous",
    "Gérson": "brain",
    "Tostão": "intelligent",
    "Just Fontaine": "prolific",
    "Raymond Kopa": "pioneer",
    "Sándor Kocsis": "headers",
    "Ferenc Puskás": "cannon",
    "Nándor Hidegkuti": "deep",
    "Uwe Seeler": "stocky",
    "Helmut Rahn": "decisive",
    "Fritz Walter": "captain",
    "Karl-Heinz Rummenigge": "sleek",
    "Pierre Littbarski": "bandy",
    "Rudi Völler": "curls",
    "Jürgen Klinsmann": "diver",
    "Andreas Brehme": "two-footed",
    "Paolo Rossi": "redemption",
    "Salvatore Schillaci": "surprise",
    "Dino Zoff": "ageless",
    "Gaetano Scirea": "gentleman",
    "Marco Tardelli": "tenacious",
    "Mario Kempes": "mane",
    "Daniel Passarella": "iron",
    "Jorge Burruchaga": "winner",
    "Claudio Caniggia": "flowing",
    "Gabriel Batistuta": "power",
    "Hristo Stoichkov": "fiery",
    "Roger Milla": "dancing",
    "Oleg Salenko": "one-off",
    "Davor Šuker": "silky",
    "Bebeto": "partner",
    "Dunga": "snarling",
    "Cláudio Taffarel": "shootouts",
    "Guillermo Ochoa": "heroics",
    "Keylor Navas": "underdog",
    "Tim Howard": "saves",
    "James Rodríguez": "breakout",
    "Unai Simón": "modern",
}


def entries(raw):
    """Accept either a list of names or a list of {name, hint}."""
    for item in raw:
        yield item if isinstance(item, str) else item["name"]


def main() -> None:
    missing, problems = [], []
    for pack in ("premier_league", "champions_league", "world_cup"):
        path = DATA / f"{pack}.json"
        data = json.loads(path.read_text(encoding="utf-8"))
        out, seen = {}, Counter()

        for tier, raw in data.items():
            rows = []
            for name in entries(raw):
                hint = HINTS.get(name)
                if hint is None:
                    missing.append(f"{pack}: {name}")
                    hint = ""
                # One word, always. The card gives a clue the size of a word,
                # and two words start to read like a description.
                if len(hint.split()) > 1:
                    problems.append(f"{pack}: '{name}' has a {len(hint.split())}-word hint '{hint}'")
                seen[hint] += 1
                rows.append({"name": name, "hint": hint})
            out[tier] = rows

        # Two players in the same pack sharing a hint is not a bug, but it
        # blunts the hint, so it gets flagged rather than silently shipped.
        for hint, n in seen.items():
            if n > 1 and hint:
                problems.append(f"{pack}: {n} players share the hint '{hint}'")

        path.write_text(
            json.dumps(out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
        total = sum(len(v) for v in out.values())
        print(f"{pack:18} {total} players, {len(set(seen)) } distinct hints")

    for line in missing:
        print("MISSING HINT:", line)
    for line in problems:
        print("DUPLICATE:", line)
    if not missing and not problems:
        print("every player has a hint, and no hint repeats inside a pack")


if __name__ == "__main__":
    main()
