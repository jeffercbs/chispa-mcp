export const CATEGORY_LABEL = {
    no_metal: "No metal",
    gas_noble: "Gas noble",
    alcalino: "Metal alcalino",
    alcalinoterreo: "Metal alcalinotérreo",
    metaloide: "Metaloide",
    halogeno: "Halógeno",
    transicion: "Metal de transición",
    otro_metal: "Otro metal",
    lantanido: "Lantánido",
    actinido: "Actínido"
};
export const CATEGORIES = Object.keys(CATEGORY_LABEL);
const RAW = "H Hidrógeno 1.008|He Helio 4.0026|Li Litio 6.94|Be Berilio 9.0122|B Boro 10.81|C Carbono 12.011|N Nitrógeno 14.007|O Oxígeno 15.999|F Flúor 18.998|Ne Neón 20.180|Na Sodio 22.990|Mg Magnesio 24.305|Al Aluminio 26.982|Si Silicio 28.085|P Fósforo 30.974|S Azufre 32.06|Cl Cloro 35.45|Ar Argón 39.948|K Potasio 39.098|Ca Calcio 40.078|Sc Escandio 44.956|Ti Titanio 47.867|V Vanadio 50.942|Cr Cromo 51.996|Mn Manganeso 54.938|Fe Hierro 55.845|Co Cobalto 58.933|Ni Níquel 58.693|Cu Cobre 63.546|Zn Zinc 65.38|Ga Galio 69.723|Ge Germanio 72.630|As Arsénico 74.922|Se Selenio 78.971|Br Bromo 79.904|Kr Kriptón 83.798|Rb Rubidio 85.468|Sr Estroncio 87.62|Y Itrio 88.906|Zr Circonio 91.224|Nb Niobio 92.906|Mo Molibdeno 95.95|Tc Tecnecio 98|Ru Rutenio 101.07|Rh Rodio 102.91|Pd Paladio 106.42|Ag Plata 107.87|Cd Cadmio 112.41|In Indio 114.82|Sn Estaño 118.71|Sb Antimonio 121.76|Te Telurio 127.60|I Yodo 126.90|Xe Xenón 131.29|Cs Cesio 132.91|Ba Bario 137.33|La Lantano 138.91|Ce Cerio 140.12|Pr Praseodimio 140.91|Nd Neodimio 144.24|Pm Prometio 145|Sm Samario 150.36|Eu Europio 151.96|Gd Gadolinio 157.25|Tb Terbio 158.93|Dy Disprosio 162.50|Ho Holmio 164.93|Er Erbio 167.26|Tm Tulio 168.93|Yb Iterbio 173.05|Lu Lutecio 174.97|Hf Hafnio 178.49|Ta Tántalo 180.95|W Wolframio 183.84|Re Renio 186.21|Os Osmio 190.23|Ir Iridio 192.22|Pt Platino 195.08|Au Oro 196.97|Hg Mercurio 200.59|Tl Talio 204.38|Pb Plomo 207.2|Bi Bismuto 208.98|Po Polonio 209|At Astato 210|Rn Radón 222|Fr Francio 223|Ra Radio 226|Ac Actinio 227|Th Torio 232.04|Pa Protactinio 231.04|U Uranio 238.03|Np Neptunio 237|Pu Plutonio 244|Am Americio 243|Cm Curio 247|Bk Berkelio 247|Cf Californio 251|Es Einstenio 252|Fm Fermio 257|Md Mendelevio 258|No Nobelio 259|Lr Lawrencio 266|Rf Rutherfordio 267|Db Dubnio 268|Sg Seaborgio 269|Bh Bohrio 270|Hs Hasio 277|Mt Meitnerio 278|Ds Darmstadtio 281|Rg Roentgenio 282|Cn Copernicio 285|Nh Nihonio 286|Fl Flerovio 289|Mc Moscovio 290|Lv Livermorio 293|Ts Teneso 294|Og Oganesón 294";
const NON_METALS = new Set([1, 6, 7, 8, 15, 16, 34]);
const NOBLE = new Set([2, 10, 18, 36, 54, 86, 118]);
const HALOGENS = new Set([9, 17, 35, 53, 85, 117]);
const METALLOIDS = new Set([5, 14, 32, 33, 51, 52]);
const PERIOD_END = [2, 10, 18, 36, 54, 86, 118];
function categoryOf(n) {
    if (NOBLE.has(n))
        return "gas_noble";
    if (HALOGENS.has(n))
        return "halogeno";
    if (NON_METALS.has(n))
        return "no_metal";
    if (METALLOIDS.has(n))
        return "metaloide";
    if (n >= 57 && n <= 71)
        return "lantanido";
    if (n >= 89 && n <= 103)
        return "actinido";
    if ([3, 11, 19, 37, 55, 87].includes(n))
        return "alcalino";
    if ([4, 12, 20, 38, 56, 88].includes(n))
        return "alcalinoterreo";
    if ((n >= 21 && n <= 30) || (n >= 39 && n <= 48) || (n >= 72 && n <= 80) || (n >= 104 && n <= 112))
        return "transicion";
    return "otro_metal";
}
function layout(n) {
    const period = PERIOD_END.findIndex((end) => n <= end) + 1;
    if (n >= 57 && n <= 71)
        return { period: 6, group: null, col: 3 + (n - 57), row: 9 };
    if (n >= 89 && n <= 103)
        return { period: 7, group: null, col: 3 + (n - 89), row: 10 };
    let col;
    if (n === 1)
        col = 1;
    else if (n === 2)
        col = 18;
    else if (period <= 3) {
        const start = (PERIOD_END[period - 2] ?? 0) + 1;
        const offset = n - start;
        col = offset < 2 ? offset + 1 : offset + 11;
    }
    else if (period <= 5)
        col = n - (PERIOD_END[period - 2] ?? 0);
    else {
        const start = (PERIOD_END[period - 2] ?? 0) + 1;
        const offset = n - start;
        const lower = period === 6 ? 72 : 104;
        col = n >= lower ? 4 + (n - lower) : offset + 1;
    }
    return { period, group: col, col, row: period };
}
export const ELEMENTS = RAW.split("|").map((entry, index) => {
    const [symbol = "", name = "", mass = "0"] = entry.split(" ");
    const number = index + 1;
    return { number, symbol, name, mass: Number(mass), category: categoryOf(number), ...layout(number) };
});
const normalize = (value) => value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim()
    .toLowerCase();
const INDEX = new Map();
for (const element of ELEMENTS) {
    INDEX.set(normalize(element.symbol), element);
    INDEX.set(normalize(element.name), element);
    INDEX.set(String(element.number), element);
}
export function findElement(reference) {
    return INDEX.get(normalize(reference)) ?? null;
}
export const PERIODIC_ASKS = ["ubicar", "simbolo", "nombre", "numero", "categoria"];
export const PERIODIC_ASK_LABEL = {
    ubicar: "Ubica el elemento en la tabla",
    simbolo: "¿Cuál es su símbolo?",
    nombre: "¿Cómo se llama?",
    numero: "¿Cuál es su número atómico?",
    categoria: "¿A qué familia pertenece?"
};
