// Historical AI / computing pioneers shown in the "AI Pioneers" rail on the home page.
// They are inspirational profiles only - not AI models, not connected to any backend.
// To replace a portrait: drop a square jpg into public/images/pioneers/ and change `image` (or set it
// to null to show an initials card). Credits are listed under the rail, as the licences require.

export type Pioneer = {
  id: string;
  name: string;
  role: string;
  /** path under /public, or null for an initials card until a freely usable photo is added */
  image: string | null;
  credit: { author: string; license: string; source: string | null } | null;
};

const commons = (file: string) => `https://commons.wikimedia.org/wiki/File:${file}`;

export const PIONEERS: Pioneer[] = [
  {
    id: "alan-turing",
    name: "Alan Turing",
    role: "Computing & Machine Intelligence Pioneer",
    image: "/images/pioneers/alan-turing.jpg",
    credit: { author: "Elliott & Fry", license: "Public domain", source: commons("Alan_turing_header.jpg") },
  },
  {
    id: "john-mccarthy",
    name: "John McCarthy",
    role: "AI Pioneer · Lisp Creator",
    image: "/images/pioneers/john-mccarthy.jpg",
    credit: { author: "null0 (Flickr)", license: "CC BY-SA 2.0", source: commons("John_McCarthy_Stanford.jpg") },
  },
  {
    id: "marvin-minsky",
    name: "Marvin Minsky",
    role: "Early AI Pioneer",
    image: "/images/pioneers/marvin-minsky.jpg",
    credit: {
      author: "Sethwoodworth (OLPC)",
      license: "CC BY 3.0",
      source: commons("Marvin_Minsky_at_OLPCb_(3x4_cropped).jpg"),
    },
  },
  {
    id: "geoffrey-hinton",
    name: "Geoffrey Hinton",
    role: "Deep Learning Pioneer",
    image: "/images/pioneers/geoffrey-hinton.jpg",
    credit: { author: "Cmichel67", license: "CC BY-SA 4.0", source: commons("Geoffrey_Hinton_in_2026.jpg") },
  },
  {
    id: "arthur-samuel",
    name: "Arthur Samuel",
    role: "Machine Learning Pioneer",
    image: "/images/pioneers/arthur-samuel.jpg",
    // supplied by the site owner; no free licence could be found, so the rights should be confirmed
    credit: { author: "Historical photograph supplied by the site owner", license: "rights to be confirmed", source: null },
  },
  {
    id: "claude-shannon",
    name: "Claude Shannon",
    role: "Information Theory Pioneer",
    image: "/images/pioneers/claude-shannon.jpg",
    credit: {
      author: "Tekniska museet",
      license: "CC BY 2.0",
      source: commons("C.E._Shannon._Tekniska_museet_43069_(2x3_crop).jpg"),
    },
  },
  {
    id: "norbert-wiener",
    name: "Norbert Wiener",
    role: "Cybernetics Pioneer",
    image: "/images/pioneers/norbert-wiener.jpg",
    credit: { author: "Garry Olsh", license: "CC0", source: commons("Norbert_Wiener.png") },
  },
  {
    id: "herbert-simon",
    name: "Herbert A. Simon",
    role: "AI & Cognitive Science Pioneer",
    image: "/images/pioneers/herbert-simon.jpg",
    credit: {
      author: "Rochester Institute of Technology",
      license: "Public domain",
      source: commons("Herbert_Simon,_RIT_NandE_Vol13Num11_1981_Mar19_Complete.jpg"),
    },
  },
  {
    id: "allen-newell",
    name: "Allen Newell",
    role: "Symbolic AI Pioneer",
    image: "/images/pioneers/allen-newell.jpg",
    credit: {
      author: "Paolo Massa",
      license: "Public domain",
      source: commons("Herbert_A._Simon_and_Allen_Newell_Chess_Match.jpg"),
    },
  },
  {
    id: "frank-rosenblatt",
    name: "Frank Rosenblatt",
    role: "Perceptron & Neural Network Pioneer",
    image: "/images/pioneers/frank-rosenblatt.jpg",
    credit: { author: "Unknown", license: "CC BY-SA 4.0", source: commons("Frank_Rosenblatt.jpg") },
  },
];
