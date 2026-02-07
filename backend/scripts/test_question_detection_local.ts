
import axios from 'axios';

interface TestCase {
    id: string;
    source: string;
    text: string;
    realScore: number;
    realStatus: string;
}

const testCases: TestCase[] = [
    // ==================================================================================
    // SET A: Edexcel GCSE 1MA1/3H June 2024 (21 Questions) - USING FULL TEXT
    // ==================================================================================
    // ==================================================================================
    // SET A: Edexcel GCSE 1MA1/3H June 2024 (21 Questions) - GLOBAL SEARCH PARITY
    // ==================================================================================
    { id: "3H-Q1", source: "1MA1/3H", text: "Find the highest common factor (HCF) of 63 and 105", realScore: 0.850, realStatus: "SUCCESS" },
    { id: "3H-Q2", source: "1MA1/3H", text: "Calculate the value of 9.7 x 10+ 2.45 × 10'\nGive your answer in standard form.\n\nWrite 5.3 x 10' as an ordinary number.\n\nWrite 7.4 x 10 as an ordinary number.", realScore: 0.870, realStatus: "SUCCESS" },
    { id: "3H-Q3", source: "1MA1/3H", text: "The diagram shows a solid triangular prism.\nRana is trying to draw the side elevation of the solid prism from the direction of the arrow.\nHere is her answer on a centimetre grid.\n\nOn the centimetre grid below, draw a plan of the solid prism.\n\nExplain why Rana's side elevation is not correct.", realScore: 0.786, realStatus: "SUCCESS" },
    { id: "3H-Q4", source: "1MA1/3H", text: "A company has 25 000 workers.\nThe number of workers increases at a rate of 6% per year for 3 years.\nCalculate the total number of workers at the end of the 3 years.", realScore: 0.930, realStatus: "SUCCESS" },
    { id: "3H-Q5", source: "1MA1/3H", text: "Habib has two identical tins.\nHe puts 600 grams of flour into one of the tins.\nThe flour fills the tin completely.\nThe density of the flour is 0.6 g/cm³\nHabib puts 600 grams of salt into the other tin.\nThe salt does not fill the tin completely.\nThe volume of the space in the tin that is not filled with salt is 700 cm³\nWork out the density of the salt.\nYou must show all your working.", realScore: 0.943, realStatus: "SUCCESS" },
    { id: "3H-Q6", source: "1MA1/3H", text: "Tim has two biased coins, coin A and coin B.\nHe is going to throw both coins.\nThe probability that coin A will land on heads is 0.6\nThe probability that coin B will land on heads is 0.55\n\nWork out the probability that both coins land on heads.\n\nComplete the probability tree diagram.", realScore: 0.959, realStatus: "SUCCESS" },
    { id: "3H-Q7", source: "1MA1/3H", text: "A paddling pool is in the shape of a cylinder.\nThe pool has radius 100cm.\nThe pool has depth 30cm.\nThe pool is empty.\nIt is then filled with water at a rate of 250cm' per second.\nWork out the number of minutes it takes to fill the pool completely.\nGive your answer correct to the nearest minute.\nYou must show all your working.", realScore: 0.945, realStatus: "SUCCESS" },
    { id: "3H-Q8", source: "1MA1/3H", text: "a = \\begin{pmatrix} 3 \\\\ 2 \\end{pmatrix} b = \\begin{pmatrix} -1 \\\\ 4 \\end{pmatrix}\nOn the grid below, draw and label the vector 2a + b", realScore: 0.811, realStatus: "SUCCESS" },
    { id: "3H-Q9", source: "1MA1/3H", text: "The diagram shows a cube and a square-based pyramid.\nThe volume of the cube is equal to the volume of the pyramid.\nWork out the perpendicular height, hcm, of the pyramid.", realScore: 0.790, realStatus: "SUCCESS" },
    { id: "3H-Q10", source: "1MA1/3H", text: "There are only red counters and yellow counters in bag A.\nnumber of red counters: number of yellow counters=3:5\nThere are only green counters and blue counters in bag B.\nThe number of counters in bag B is half the number of counters in bag A.\nGiven that there are x red counters in bag A,\nuse algebra to show that the total number of counters in bag A and bag B is 4x", realScore: 1.000, realStatus: "SUCCESS" },
    { id: "3H-Q11", source: "1MA1/3H", text: "Mina records the speeds, in mph, of some cars on a road on Friday.\nShe uses her results to work out the information in this table.\n\nCompare the distribution of the speeds on Friday with the distribution of the speeds on Sunday.\n\nOn the grid, draw a box plot to show the information in the table.", realScore: 0.733, realStatus: "SUCCESS" },
    { id: "3H-Q12", source: "1MA1/3H", text: "The diagram shows triangle T drawn on a grid.\nEnlarge triangle T by scale factor -2 with centre of enlargement (0, 0)", realScore: 0.895, realStatus: "SUCCESS" },
    { id: "3H-Q13", source: "1MA1/3H", text: "There are 30 students in a class.\nA teacher is going to choose at random 2 of the students.\nWork out the number of different pairs of students that the teacher can choose.", realScore: 1.000, realStatus: "SUCCESS" },
    { id: "3H-Q14", source: "1MA1/3H", text: "At the start of 2022 Kim invested some money in a savings account.\nThe account paid 3.5% compound interest each year.\nAt the end of 2022\ninterest was added to the account then Kim took £750 from the account.\nAt the end of 2023\ninterest was added to the account then Kim took £1000 from the account.\nThere was then £2937.14 in the account.\nWork out how much money Kim invested at the start of 2022\nYou must show all your working.", realScore: 1.000, realStatus: "SUCCESS" },
    { id: "3H-Q15", source: "1MA1/3H", text: "Simplify fully \\frac{4-x^2}{x^2+3x} \\div \\frac{x+2}{x+3}\n\nSimplify fully \\frac{(a-3)^2}{5(a-3)}\n\nFactorise 3k^2 + 11k - 4", realScore: 0.927, realStatus: "SUCCESS" },
    { id: "3H-Q16", source: "1MA1/3H", text: "The functions f and g are given by\n\nFind f(-3)\n\nFind fg(1)\n\nFind g¹(4)", realScore: 0.833, realStatus: "SUCCESS" },
    { id: "3H-Q17", source: "1MA1/3H", text: "A ball is thrown upwards and reaches a maximum height.\nThe ball then falls and bounces repeatedly.\nAfter the nth bounce, the ball reaches a height of h\nAfter the next bounce, the ball reaches a height given by h₁ = 0.55h,\nAfter the Ist bounce, the ball reaches a height of 8 metres.\nWhat height does the ball reach after the 4th bounce?", realScore: 0.932, realStatus: "SUCCESS" },
    { id: "3H-Q18", source: "1MA1/3H", text: "ABCD is a quadrilateral.\nThe area of triangle ABC is 54 cm²\nCalculate the area of triangle ACD.\nGive your answer correct to 3 significant figures.", realScore: 0.844, realStatus: "SUCCESS" },
    { id: "3H-Q19", source: "1MA1/3H", text: "R = \\frac{P}{Q}\nP = 5.88 x 10\" correct to 3 significant figures.\nQ = 3.6 x 10' correct to 2 significant figures.\nWork out the lower bound for R.\nGive your answer as an ordinary number correct to the nearest integer.\nYou must show all your working.", realScore: 0.932, realStatus: "SUCCESS" },
    { id: "3H-Q20", source: "1MA1/3H", text: "y-4, y + 2 and 3y + 1 are three consecutive terms of a geometric sequence.\nFind the possible values of y.\n\nx - 4, x + 2 and 3x + 1 are three consecutive terms of an arithmetic sequence.\n\nFind the value of x.", realScore: 0.997, realStatus: "SUCCESS" },
    { id: "3H-Q21", source: "1MA1/3H", text: "The diagram shows a circle, radius r cm and two regular hexagons.\nEach side of the larger hexagon ABCDEF is a tangent to the circle.\nEach side of the smaller hexagon PQRSTU is a chord of the circle.\nBy considering perimeters, show that\n3 < π < 2√3", realScore: 0.987, realStatus: "SUCCESS" },

    // ==================================================================================
    // SET B: Edexcel GCSE 1MA1/1H June 2024 (23 Questions) - GLOBAL SEARCH PARITY
    // ==================================================================================
    { id: "1H-Q1", source: "1MA1/1H", text: "Here are the first four terms of an arithmetic sequence.\n1 5 9 13\nFind an expression, in terms of n, for the nth term of this sequence.", realScore: 1.000, realStatus: "SUCCESS" },
    { id: "1H-Q2", source: "1MA1/1H", text: "Work out 3\\frac{4}{5} - 1\\frac{2}{3}\\\\nWhat mistake has Kevin made?", realScore: 0.692, realStatus: "RESCUED" },
    { id: "1H-Q3", source: "1MA1/1H", text: "The diagram shows a plan of a floor.\nPetra is going to cover the floor with paint.\nPetra has 3 tins of paint.\nThere are 2.5 litres of paint in each tin.\nPetra thinks 1 litre of paint will cover 10m² of floor.\n\nActually, 1 litre of paint will cover 11 m² of floor.\nDoes this affect your answer to part (a)?\nYou must give a reason for your answer.\n\nAssuming Petra is correct, does she have enough paint to cover the floor?\nYou must show all your working.", realScore: 0.958, realStatus: "SUCCESS" },
    { id: "1H-Q4", source: "1MA1/1H", text: "A number is chosen at random from the universal set, \\&.\nFind the probability that this number is in the set P\\cup Q\n\nWrite down the numbers that are in set P'\n\nHere is a Venn diagram.", realScore: 0.864, realStatus: "SUCCESS" },
    { id: "1H-Q5", source: "1MA1/1H", text: "Sophie drives a distance of 513 kilometres on a motorway in France.\nShe pays 0.81 euros for every 10 kilometres she drives.\n\nIs your answer to part (a) an underestimate or an overestimate?\nGive a reason for your answer.\n\nWork out an estimate for the total amount that Sophie pays.", realScore: 1.000, realStatus: "SUCCESS" },
    { id: "1H-Q6", source: "1MA1/1H", text: "Here is a straight line L drawn on a grid.\n\nFind an equation for L.\n\nWrite down the equation of a straight line parallel to M.", realScore: 0.567, realStatus: "RESCUED" },
    { id: "1H-Q7", source: "1MA1/1H", text: "Kasim has some small jars, some medium jars and some large jars.\nHe has a total of 400 jars.\n\\frac{3}{8} of the 400 jars are empty.\nFor the empty jars,\nnumber of small jars : number of medium jars = 3:4\nnumber of medium jars: number of large jars = 1:2\nWork out the percentage of Kasim's jars that are empty small jars.", realScore: 1.000, realStatus: "SUCCESS" },
    { id: "1H-Q8", source: "1MA1/1H", text: "Len has 8 parcels.\nThe mean weight of the 8 parcels is 2.5 kg.\nThe mean weight of 3 of the parcels is 2kg.\nWork out the mean weight of the other 5 parcels.", realScore: 1.000, realStatus: "SUCCESS" },
    { id: "1H-Q9", source: "1MA1/1H", text: "In a sale, the normal price of a coat is reduced by R%\nGiven that\nsale price = 0.7 × normal price\nfind the value of R.", realScore: 0.987, realStatus: "SUCCESS" },
    { id: "1H-Q10", source: "1MA1/1H", text: "Solve the simultaneous equations", realScore: 0.704, realStatus: "RESCUED" },
    { id: "1H-Q11", source: "1MA1/1H", text: "Triangle A is translated by the vector $\\begin{pmatrix} 6 \\\\ -4 \\end{pmatrix}$ to give triangle B.\nTriangle B is rotated 90° clockwise about the point (1, 2) to give triangle C.\nDescribe fully the single transformation that maps triangle A onto triangle C.", realScore: 0.990, realStatus: "SUCCESS" },
    { id: "1H-Q12", source: "1MA1/1H", text: "Here are some graphs. Write down the letter of the graph that could have the equation\n\ny = -\\frac{5}{x}\n\ny = x² - 4\n\ny = -x³", realScore: 0.870, realStatus: "SUCCESS" },
    { id: "1H-Q13", source: "1MA1/1H", text: "Work out an estimate for the fraction of these 150 people who were in the shop for between 20 minutes and 40 minutes.\n\nThe table gives information about the amount of time that each of 150 people were in a shop.\n\nOn the grid, draw a histogram for this information.", realScore: 0.998, realStatus: "SUCCESS" },
    { id: "1H-Q14", source: "1MA1/1H", text: "Expand and simplify (3x-1)(2x + 3)(x - 5)", realScore: 1.000, realStatus: "SUCCESS" },
    { id: "1H-Q15", source: "1MA1/1H", text: "OAB is a sector of a circle with centre O and radius 6cm.\nThe length of the arc AB is 5\\pi cm.\nWork out, in terms of \\pi, the area of the sector.\nGive your answer in its simplest form.", realScore: 0.992, realStatus: "SUCCESS" },
    { id: "1H-Q16", source: "1MA1/1H", text: "There are only n orange sweets and 1 white sweet in a bag.\nSaira takes at random a sweet from the bag and eats the sweet.\nShe then takes at random another sweet from the bag and eats this sweet.\nShow that the probability that Saira eats two orange sweets is \\frac{n-1}{n+1}", realScore: 1.000, realStatus: "SUCCESS" },
    { id: "1H-Q17", source: "1MA1/1H", text: "Rationalise the denominator of \\frac{1}{\\sqrt{7}}\n\nSimplify fully \\sqrt{80}-\\sqrt{5}", realScore: 1.000, realStatus: "SUCCESS" },
    { id: "1H-Q18", source: "1MA1/1H", text: "Show that 0.15 + 0.227 can be written in the form \\frac{m}{66} where m is an integer.", realScore: 0.757, realStatus: "RESCUED" },
    { id: "1H-Q19", source: "1MA1/1H", text: "ABC and DAB are similar isosceles triangles.\nAB = AC\nAD = BD\nBC: CD=4:21\nFind the ratio AB: AD", realScore: 1.000, realStatus: "SUCCESS" },
    { id: "1H-Q20", source: "1MA1/1H", text: "2* = \\frac{2^{n}}{\\sqrt{2}}\n2^{y} = (\\sqrt{2})^{5}\nGiven that x + y = 8\nwork out the value of n.", realScore: 0.983, realStatus: "SUCCESS" },
    { id: "1H-Q21", source: "1MA1/1H", text: "A solid cuboid has a volume of 300 cm³.\nThe cuboid has a total surface area of 370 cm².\nThe length of the cuboid is 20 cm.\nThe width of the cuboid is greater than the height of the cuboid.\nWork out the height of the cuboid.\nYou must show all your working.", realScore: 0.906, realStatus: "SUCCESS" },
    { id: "1H-Q22", source: "1MA1/1H", text: "Solve the equation 2 sinx = -1 for 0 ≤ x ≤ 360\n\nSketch the graph of y = sinx° for 0 ≤ x ≤ 360", realScore: 0.924, realStatus: "SUCCESS" },
    { id: "1H-Q23", source: "1MA1/1H", text: "C is a circle with centre (0, 0)\nL is a straight line.\nThe circle C and the line L intersect at the points P and Q.\nThe coordinates of P are (5, 10)\nThe x coordinate of Q is -2\nL has a positive gradient and crosses the y-axis at the point (0, k)\nFind the value of k.", realScore: 1.000, realStatus: "SUCCESS" },

    // ==================================================================================
    // SET C: Edexcel GCSE 1MA1/2H June 2024 (22 Questions) - REAL PRODUCTION DATA
    // ==================================================================================
    { id: "2H-Q1", source: "1MA1/2H", text: "ABC is a right-angled triangle.\nWork out the length of CB.\nGive your answer correct to 3 significant figures.", realScore: 0.710, realStatus: "SUCCESS" },
    { id: "2H-Q2", source: "1MA1/2H", text: "Write down the lowest common multiple (LCM) of A and B.\nA = 2² x 3\nB = 2 x 3²\n\nWrite 90 as a product of its prime factors.", realScore: 0.968, realStatus: "SUCCESS" },
    { id: "2H-Q3", source: "1MA1/2H", text: "The number of hours, H, that some machines take to make 5000 bottles is given by\nH = \\frac{72}{n} where n is the number of machines.\nOn Monday, 6 machines made 5000 bottles.\nOn Tuesday, 9 machines made 5000 bottles.\nThe machines took more time to make the bottles on Monday than on Tuesday.\nHow much more time?", realScore: 1.000, realStatus: "SUCCESS" },
    { id: "2H-Q4", source: "1MA1/2H", text: "There are only red discs, blue discs and yellow discs in a bag.\nThere are 24 yellow discs in the bag.\nMel is going to take at random a disc from the bag.\nThe probability that the disc will be yellow is 0.16\nthe number of red discs : the number of blue discs = 5:4\nWork out the number of red discs in the bag.", realScore: 1.000, realStatus: "SUCCESS" },
    { id: "2H-Q5", source: "1MA1/2H", text: "Complete the table of values for y = x²-x\nOn the grid, draw the graph of y = x²-x for values of x from -2 to 3\nUse your graph to find estimates for the solutions of the equation x²-x=4", realScore: 0.879, realStatus: "SUCCESS" },
    { id: "2H-Q6", source: "1MA1/2H", text: "Andy, Luke and Tina share some sweets in the ratio 1:6:14\nTina gives \\frac{3}{7} of her sweets to Andy.\nTina then gives 12\\frac{1}{2}% of the rest of her sweets to Luke.\nTina says,\n\"Now all three of us have the same number of sweets.\"\nIs Tina correct?\nYou must show how you get your answer.", realScore: 1.000, realStatus: "SUCCESS" },
    { id: "2H-Q7", source: "1MA1/2H", text: "ABCD is a quadrilateral.\nAll angles are measured in degrees.\nShow that ABCD is a trapezium.", realScore: 0.790, realStatus: "SUCCESS" },
    { id: "2H-Q8", source: "1MA1/2H", text: "A playground is in the shape of a right-angled triangle.\nDan makes a scale drawing of the playground.\nHe uses a scale of 1 cm represents 5m\nThe area of the playground on the scale drawing is 28 cm²\nThe real length of QR is 40m\nWork out the real length of PQ.", realScore: 0.954, realStatus: "SUCCESS" },
    { id: "2H-Q9", source: "1MA1/2H", text: "A number N is rounded to 2 significant figures.\nThe result is 7.3\n\nIs Leila correct?\nYou must give a reason for your answer.\n\nWrite down the least possible value of N.", realScore: 0.763, realStatus: "SUCCESS" },
    { id: "2H-Q10", source: "1MA1/2H", text: "The diagram shows two right-angled triangles.\nAll lengths are measured in centimetres.\nGiven that\nsina = tan b\nwork out the value of x.", realScore: 0.790, realStatus: "SUCCESS" },
    { id: "2H-Q11", source: "1MA1/2H", text: "Use your graph to find an estimate for the number of these parcels with a weight greater than 7.4kg.\n\nOn the grid opposite, draw a cumulative frequency graph for your table.\n\nThe frequency table gives information about the weights of 60 parcels.\n\nUse your graph to find an estimate for the interquartile range.\n\nComplete the cumulative frequency table.", realScore: 0.818, realStatus: "SUCCESS" },
    { id: "2H-Q12", source: "1MA1/2H", text: "Find the positive value of d when f= 10\nGive your answer correct to 3 significant figures.\n\nf is inversely proportional to d²\nf=3.5 when d = 8\n\nFind an equation for f in terms of d.", realScore: 0.953, realStatus: "SUCCESS" },
    { id: "2H-Q13", source: "1MA1/2H", text: "On the grid, shade the region R that satisfies all the following inequalities.\nLabel the region R.", realScore: 0.726, realStatus: "SUCCESS" },
    { id: "2H-Q14", source: "1MA1/2H", text: "Work out an estimate for the distance the car travels in the first 6 seconds after it starts to slow down.\nUse 3 strips of equal width.\n\nThe graph shows the velocity of a car, in metres per second, t seconds after it starts to slow down.\n\nCalculate an estimate for the acceleration of the car when t = 5\nYou must show all your working.", realScore: 0.893, realStatus: "SUCCESS" },
    { id: "2H-Q15", source: "1MA1/2H", text: "Given that a is a prime number, rationalise the denominator of $\\frac{1}{\\sqrt{a}+1}$\nGive your answer in its simplest form.", realScore: 1.000, realStatus: "SUCCESS" },
    { id: "2H-Q16", source: "1MA1/2H", text: "Solve (4x-3) (x + 5) < 0", realScore: 1.000, realStatus: "SUCCESS" },
    { id: "2H-Q17", source: "1MA1/2H", text: "L, M and P are three similar solid cylinders made from the same material.\nL has a mass of 64 g\nM has a mass of 125 g\nM has a total surface area of 144 cm²\nP has a total surface area of 16 cm²\nWork out\nheight of cylinder L: height of cylinder M: height of cylinder P", realScore: 0.951, realStatus: "SUCCESS" },
    { id: "2H-Q18", source: "1MA1/2H", text: "There are only 4 red counters, 3 yellow counters and 1 green counter in a bag.\nTony takes at random three counters from the bag.\nWork out the probability that there are now more yellow counters than red counters in the bag.\nYou must show all your working.", realScore: 1.000, realStatus: "SUCCESS" },
    { id: "2H-Q19", source: "1MA1/2H", text: "The diagram shows quadrilateral OACB.\nM is the midpoint of OA.\nN is the point on BC such that BN: NC = 4:5\n$\\vec{OA} = a$ $\\vec{OB} = b$ $\\vec{AC} = kb$ where k is a positive integer.\n\nExpress $\\vec{MN}$ in terms of k, a and b.\nGive your answer in its simplest form.\n\nIs $\\vec{MN}$ parallel to $\\vec{OB}$?\nGive a reason for your answer.", realScore: 1.000, realStatus: "SUCCESS" },
    { id: "2H-Q20", source: "1MA1/2H", text: "The curve C has equation y = 2x² - 12x + 7\nFind the coordinates of the turning point on C.", realScore: 0.989, realStatus: "SUCCESS" },
    { id: "2H-Q21", source: "1MA1/2H", text: "The graph of y = g(x) is shown on the grid.\nOn the grid, draw the graph of y = g(-x) + 2", realScore: 0.860, realStatus: "SUCCESS" },
    { id: "2H-Q22", source: "1MA1/2H", text: "A and B are points on a circle, centre O.\nMAP and NBP are tangents to the circle.\nProve that AP = BP", realScore: 1.000, realStatus: "SUCCESS" },

    // ==================================================================================
    // SET C: Special Cases (OCR & Non-PP)
    // ==================================================================================
    {
        id: "NPP-12",
        source: "Non-PP",
        text: "Put these in order starting with the smallest.\nYou must show your working.",
        realScore: 0.732,
        realStatus: "REJECTED"
    },
    {
        id: "NPP-13",
        source: "Non-PP",
        text: "Work out the value of\nGive your answer in the form $k\\sqrt{3}$",
        realScore: 0.587,
        realStatus: "REJECTED"
    }
];

const API_BASE = "http://localhost:5001/api/debug";

async function runTest() {
    console.log("🚀 Starting INTEGRATION Test (Calling Real Backend API)...");
    console.log("🌍 API Endpoint:", `${API_BASE}/detect-question`);

    // Group outputs by Source
    const groups: { [key: string]: any[] } = { "1MA1/3H": [], "1MA1/1H": [], "1MA1/2H": [], "OCR": [], "Non-PP": [] };

    for (const tc of testCases) {
        const hintMatch = tc.id.match(/(?:Q|-)(\d+[a-z]*)/);
        const hintQ = hintMatch ? hintMatch[1].replace(/[^0-9]/g, '') : "1";

        const qNumMatch = tc.id.match(/(?:Q|-)(\d+[a-z]*)/);
        const qNumHint = qNumMatch ? qNumMatch[1] : null;

        try {
            const response = await axios.post(`${API_BASE}/detect-question`, {
                text: tc.text,
                questionNumberHint: qNumHint,
                examPaperHint: null // FORCE GLOBAL SEARCH
            });

            const result = response.data;
            const isSuccess = result.found;
            let localScore = result.match ? result.match.confidence : 0.000;

            if (!isSuccess && result.hintMetadata?.auditTrail?.length > 0) {
                localScore = result.hintMetadata.auditTrail[0].score;
            }

            const matchQ = result.match ? result.match.questionNumber : "N/A";
            const correctlyIdentified = (isSuccess && matchQ.startsWith(hintQ)) ||
                (localScore > 0 && result.hintMetadata?.auditTrail?.[0]?.candidateId.includes(`Q${hintQ}`));

            let icon = "✅";
            if (!isSuccess) icon = "❌ (Rejected)";
            else if (localScore < 0.8) icon = "❌ (Low Score)";
            else icon = "✅";


            const matchedPaper = result.match ? result.match.paperCode :
                (result.hintMetadata?.auditTrail?.[0]?.candidateId?.split(' ')[0] || "None");

            (groups[tc.source] || groups["Non-PP"]).push({
                id: tc.id,
                text: tc.text.substring(0, 30).replace(/\n/g, ' '),
                local: (localScore || 0).toFixed(3),
                real: (tc.realScore || 0).toFixed(3),
                paper: matchedPaper,
                icon
            });

        } catch (err: any) {
            console.error(`❌ API Error for ${tc.id}:`, err.response?.data || err.message);
            if (err.code === 'ECONNREFUSED') {
                console.error("❗ Backend server is NOT running. Please run 'npm run dev' in the backend directory.");
                process.exit(1);
            }
        }
    }

    // Print Tables
    console.log("\n==========================================================================================================");
    console.log("| ID       | Snippet                        | Local | Real  | Paper          | Verdict      |");
    console.log("|----------|--------------------------------|-------|-------|----------------|--------------|");

    Object.keys(groups).forEach(source => {
        if (groups[source].length === 0) return;
        console.log(`| --- ${source} --- | | | | | |`);
        groups[source].forEach(r => {
            const score = parseFloat(r.local);

            // Color coding: Green >= 0.8, Yellow < 0.8 but found, Red < 0.8 (Rejected)
            let color = "\x1b[31m"; // Default Red
            if (score >= 0.8) color = "\x1b[32m";      // Green
            else if (r.icon.includes("Low Score")) color = "\x1b[33m"; // Yellow

            const coloredLocal = `${color}${r.local.padEnd(5)}\x1b[0m`;

            console.log(`| ${r.id.padEnd(8)} | ${r.text.padEnd(30)} | ${coloredLocal} | ${r.real.padEnd(5)} | ${(r.paper || "N/A").padEnd(14)} | ${r.icon.padEnd(12)} |`);
        });
    });
    console.log("==========================================================================================================");

    process.exit(0);
}

runTest().catch(console.error);
