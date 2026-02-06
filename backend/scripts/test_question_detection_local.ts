
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
    { id: "3H-Q1", source: "1MA1/3H", text: "Find the highest common factor (HCF) of 63 and 105", realScore: 0.643, realStatus: "RESCUED" },
    { id: "3H-Q2", source: "1MA1/3H", text: "Write 5.3 x 10^4 as an ordinary number.", realScore: 0.880, realStatus: "SUCCESS" },
    { id: "3H-Q3", source: "1MA1/3H", text: "The diagram shows a solid triangular prism.\nRana is trying to draw the side elevation of the solid prism from the direction of the arrow.\nHere is her answer on a centimetre grid.", realScore: 0.801, realStatus: "SUCCESS" },
    { id: "3H-Q4", source: "1MA1/3H", text: "A company has 25 000 workers.\nThe number of workers increases at a rate of 6% per year for 3 years.\nCalculate the total number of workers at the end of the 3 years.", realScore: 0.879, realStatus: "SUCCESS" },
    { id: "3H-Q5", source: "1MA1/3H", text: "Habib has two identical tins.\nHe puts 600 grams of flour into one of the tins.\nThe flour fills the tin completely.\nThe density of the flour is 0.6 g/cm³\nHabib puts 600 grams of salt into the other tin.\nThe salt does not fill the tin completely.\nThe volume of the space in the tin that is not filled with salt is 700 cm³\nWork out the density of the salt.\nYou must show all your working.", realScore: 0.870, realStatus: "SUCCESS" },
    { id: "3H-Q6", source: "1MA1/3H", text: "Tim has two biased coins, coin A and coin B.\nHe is going to throw both coins.\nThe probability that coin A will land on heads is 0.6\nThe probability that coin B will land on heads is 0.55", realScore: 0.863, realStatus: "SUCCESS" },
    { id: "3H-Q7", source: "1MA1/3H", text: "A paddling pool is in the shape of a cylinder.\nThe pool has radius 100cm.\nThe pool has depth 30cm.\nThe pool is empty.\nIt is then filled with water at a rate of 250cm' per second.\nWork out the number of minutes it takes to fill the pool completely.\nGive your answer correct to the nearest minute.\nYou must show all your working.", realScore: 0.840, realStatus: "SUCCESS" },
    { id: "3H-Q8", source: "1MA1/3H", text: "a = \\begin{pmatrix} 3 \\\\ 2 \\end{pmatrix} b = \\begin{pmatrix} -1 \\\\ 4 \\end{pmatrix}\nOn the grid below, draw and label the vector 2a + b", realScore: 0.805, realStatus: "SUCCESS" },
    { id: "3H-Q9", source: "1MA1/3H", text: "The diagram shows a cube and a square-based pyramid.\nThe volume of the cube is equal to the volume of the pyramid.\nWork out the perpendicular height, hcm, of the pyramid.", realScore: 0.843, realStatus: "SUCCESS" },
    { id: "3H-Q10", source: "1MA1/3H", text: "There are only red counters and yellow counters in bag A.\nnumber of red counters: number of yellow counters=3:5\nThere are only green counters and blue counters in bag B.\nThe number of counters in bag B is half the number of counters in bag A.\nGiven that there are x red counters in bag A,\nuse algebra to show that the total number of counters in bag A and bag B is 4x", realScore: 0.907, realStatus: "SUCCESS" },
    { id: "3H-Q11", source: "1MA1/3H", text: "Mina records the speeds, in mph, of some cars on a road on Friday.\nShe uses her results to work out the information in this table.", realScore: 0.793, realStatus: "RESCUED" },
    { id: "3H-Q12", source: "1MA1/3H", text: "The diagram shows triangle T drawn on a grid.\nEnlarge triangle T by scale factor -2 with centre of enlargement (0, 0)", realScore: 0.860, realStatus: "SUCCESS" },
    { id: "3H-Q13", source: "1MA1/3H", text: "There are 30 students in a class.\nA teacher is going to choose at random 2 of the students.\nWork out the number of different pairs of students that the teacher can choose.", realScore: 0.912, realStatus: "SUCCESS" },
    { id: "3H-Q14", source: "1MA1/3H", text: "At the start of 2022 Kim invested some money in a savings account.\nThe account paid 3.5% compound interest each year.\nAt the end of 2022\ninterest was added to the account then Kim took £750 from the account.\nAt the end of 2023\ninterest was added to the account then Kim took £1000 from the account.\nThere was then £2937.14 in the account.\nWork out how much money Kim invested at the start of 2022\nYou must show all your working.", realScore: 0.887, realStatus: "SUCCESS" },
    { id: "3H-Q15", source: "1MA1/3H", text: "Simplify fully \\frac{(a-3)^2}{5(a-3)}", realScore: 0.849, realStatus: "SUCCESS" },
    { id: "3H-Q16", source: "1MA1/3H", text: "The functions f and g are given by f(x) = \\frac{12}{x+1} and g(x)=5-3x", realScore: 0.950, realStatus: "SUCCESS" },
    { id: "3H-Q17", source: "1MA1/3H", text: "A ball is thrown upwards and reaches a maximum height.\nThe ball then falls and bounces repeatedly.\nAfter the nth bounce, the ball reaches a height of h\nAfter the next bounce, the ball reaches a height given by h₁ = 0.55h,\nAfter the Ist bounce, the ball reaches a height of 8 metres.\nWhat height does the ball reach after the 4th bounce?", realScore: 0.915, realStatus: "SUCCESS" },
    { id: "3H-Q18", source: "1MA1/3H", text: "ABCD is a quadrilateral.\nThe area of triangle ABC is 54 cm²\nCalculate the area of triangle ACD.\nGive your answer correct to 3 significant figures.", realScore: 0.774, realStatus: "RESCUED" },
    { id: "3H-Q19", source: "1MA1/3H", text: "R = \\frac{P}{Q}\nP = 5.88 x 10^9 correct to 3 significant figures.\nQ = 3.6 x 10^4 correct to 2 significant figures.\nWork out the lower bound for R.\nGive your answer as an ordinary number correct to the nearest integer.\nYou must show all your working.", realScore: 0.853, realStatus: "SUCCESS" },
    { id: "3H-Q20", source: "1MA1/3H", text: "x - 4, x + 2 and 3x + 1 are three consecutive terms of an arithmetic sequence.", realScore: 0.858, realStatus: "SUCCESS" },
    { id: "3H-Q21", source: "1MA1/3H", text: "The diagram shows a circle, radius r cm and two regular hexagons.\nEach side of the larger hexagon ABCDEF is a tangent to the circle.\nEach side of the smaller hexagon PQRSTU is a chord of the circle.\nBy considering perimeters, show that\n3 < π < 2√3", realScore: 0.804, realStatus: "SUCCESS" },

    // ==================================================================================
    // SET B: Edexcel GCSE 1MA1/2H June 2024 (22 Questions) - REAL PRODUCTION DATA
    // ==================================================================================
    { id: "2H-Q1", source: "1MA1/2H", text: "ABC is a right-angled triangle.\nWork out the length of CB.\nGive your answer correct to 3 significant figures.\n\n\\sqrt{19^2-10^2} =3\\sqrt{29}\n16.1", realScore: 0.694, realStatus: "RESCUED" },
    { id: "2H-Q2a", source: "1MA1/2H", text: "Write 90 as a product of its prime factors.\n\n2x3²x5", realScore: 0.828, realStatus: "SUCCESS" },
    { id: "2H-Q2b", source: "1MA1/2H", text: "Write down the lowest common multiple (LCM) of A and B.\nA = 2² x 3\nB = 2 x 3²\n\n2²x3²", realScore: 0.828, realStatus: "SUCCESS" },
    { id: "2H-Q3", source: "1MA1/2H", text: "The number of hours, H, that some machines take to make 5000 bottles is given by\nH = \\frac{72}{n} where n is the number of machines.\nOn Monday, 6 machines made 5000 bottles.\nOn Tuesday, 9 machines made 5000 bottles.\nThe machines took more time to make the bottles on Monday than on Tuesday.\nHow much more time?\n\n\\frac{72}{6} - \\frac{72}{9}", realScore: 0.972, realStatus: "SUCCESS" },
    { id: "2H-Q4", source: "1MA1/2H", text: "There are only red discs, blue discs and yellow discs in a bag.\nThere are 24 yellow discs in the bag.\nMel is going to take at random a disc from the bag.\nThe probability that the disc will be yellow is 0.16\nthe number of red discs : the number of blue discs = 5:4\nWork out the number of red discs in the bag.\n\n\\frac{24}{24+r+b} = 0.16", realScore: 0.887, realStatus: "SUCCESS" },
    { id: "2H-Q5a", source: "1MA1/2H", text: "Complete the table of values for y = x²-x\n\n-2, 6, -1, 2, 0, 0, 1, 0, 2, 2, 3, 6", realScore: 0.816, realStatus: "SUCCESS" },
    { id: "2H-Q5b", source: "1MA1/2H", text: "On the grid, draw the graph of y = x²-x for values of x from -2 to 3\n\n[DRAWING]", realScore: 0.816, realStatus: "SUCCESS" },
    { id: "2H-Q5c", source: "1MA1/2H", text: "Use your graph to find estimates for the solutions of the equation x²-x=4\n\n-1.6, 2.6", realScore: 0.816, realStatus: "SUCCESS" },
    { id: "2H-Q6", source: "1MA1/2H", text: "Andy, Luke and Tina share some sweets in the ratio 1:6:14\nTina gives \\frac{3}{7} of her sweets to Andy.\nTina then gives 12\\frac{1}{2}% of the rest of her sweets to Luke.\nTina says,\n\"Now all three of us have the same number of sweets.\"\nIs Tina correct?\nYou must show how you get your answer.\n\nAndy: Luke: Tina", realScore: 0.891, realStatus: "SUCCESS" },
    { id: "2H-Q7", source: "1MA1/2H", text: "ABCD is a quadrilateral.\nAll angles are measured in degrees.\nShow that ABCD is a trapezium.\n\n4x+15 +4x+8 + 2x +15 +3x-3=360", realScore: 0.846, realStatus: "SUCCESS" },
    { id: "2H-Q8", source: "1MA1/2H", text: "A playground is in the shape of a right-angled triangle.\nDan makes a scale drawing of the playground.\nHe uses a scale of 1 cm represents 5m\nThe area of the playground on the scale drawing is 28 cm²\nThe real length of QR is 40m\nWork out the real length of PQ.\n\nArea=\\frac{1}{2}bh", realScore: 0.912, realStatus: "SUCCESS" },
    { id: "2H-Q9a", source: "1MA1/2H", text: "A number N is rounded to 2 significant figures. The result is 7.3\nWrite down the least possible value of N.\n\n7.25", realScore: 0.841, realStatus: "SUCCESS" },
    { id: "2H-Q9b", source: "1MA1/2H", text: "Is Leila correct? You must give a reason for your answer.\n\n7.349...", realScore: 0.841, realStatus: "SUCCESS" },
    { id: "2H-Q10", source: "1MA1/2H", text: "The diagram shows two right-angled triangles.\nAll lengths are measured in centimetres.\nGiven that\nsina = tan b\nwork out the value of x.\n\nSina= \\frac{7-2x}{9}", realScore: 0.811, realStatus: "SUCCESS" },
    { id: "2H-Q11a", source: "1MA1/2H", text: "Complete the cumulative frequency table.\n\n5, 18, 38, 50, 56, 60", realScore: 0.821, realStatus: "SUCCESS" },
    { id: "2H-Q11b", source: "1MA1/2H", text: "On the grid opposite, draw a cumulative frequency graph for your table.\n\n[DRAWING]", realScore: 0.821, realStatus: "SUCCESS" },
    { id: "2H-Q11c", source: "1MA1/2H", text: "Use your graph to find an estimate for the interquartile range.\n\n6.4-3", realScore: 0.821, realStatus: "SUCCESS" },
    { id: "2H-Q11d", source: "1MA1/2H", text: "Use your graph to find an estimate for the number of these parcels with a weight greater than 7.4kg.\n\n60-52 = 8", realScore: 0.821, realStatus: "SUCCESS" },
    { id: "2H-Q12a", source: "1MA1/2H", text: "f is inversely proportional to d²\nf=3.5 when d = 8\nFind an equation for f in terms of d.\n\nf=\\frac{k}{d^2}", realScore: 0.868, realStatus: "SUCCESS" },
    { id: "2H-Q12b", source: "1MA1/2H", text: "Find the positive value of d when f= 10\nGive your answer correct to 3 significant figures.\n\n4.73", realScore: 0.868, realStatus: "SUCCESS" },
    { id: "2H-Q13", source: "1MA1/2H", text: "On the grid, shade the region R that satisfies all the following inequalities.\nLabel the region R.\n\ny \\leq 3-\\frac{3}{2}x", realScore: 0.777, realStatus: "RESCUED" },
    { id: "2H-Q14a", source: "1MA1/2H", text: "Calculate an estimate for the acceleration of the car when t = 5\nYou must show all your working.\n\n\\frac{13.5-2.5}{6.4-2}", realScore: 0.796, realStatus: "RESCUED" },
    { id: "2H-Q14b", source: "1MA1/2H", text: "Work out an estimate for the distance the car travels in the first 6 seconds after it starts to slow down.\nUse 3 strips of equal width.\n\n31.5", realScore: 0.796, realStatus: "RESCUED" },
    { id: "2H-Q15", source: "1MA1/2H", text: "Given that a is a prime number, rationalise the denominator of $\\frac{1}{\\sqrt{a}+1}$\nGive your answer in its simplest form.\n\n\\frac{\\sqrt{a}-1}{a-1}", realScore: 0.926, realStatus: "SUCCESS" },
    { id: "2H-Q16", source: "1MA1/2H", text: "Solve (4x-3) (x + 5) < 0\n\nx=-5,\\frac{3}{4}", realScore: 0.926, realStatus: "SUCCESS" },
    { id: "2H-Q17", source: "1MA1/2H", text: "L, M and P are three similar solid cylinders made from the same material.\nL has a mass of 64 g\nM has a mass of 125 g\nM has a total surface area of 144 cm²\nP has a total surface area of 16 cm²\nWork out\nheight of cylinder L: height of cylinder M: height of cylinder P\n\ndensity = \\frac{mas}{volume}", realScore: 0.773, realStatus: "RESCUED" },
    { id: "2H-Q18", source: "1MA1/2H", text: "There are only 4 red counters, 3 yellow counters and 1 green counter in a bag.\nTony takes at random three counters from the bag.\nWork out the probability that there are now more yellow counters than red counters in the bag.\nYou must show all your working.\n\nR", realScore: 0.890, realStatus: "SUCCESS" },
    { id: "2H-Q19a", source: "1MA1/2H", text: "The diagram shows quadrilateral OACB.\nExpress \\overrightarrow{MN} in terms of k, a and b.\nGive your answer in its simplest form.\n\n\\overrightarrow{OM} = \\frac{a}{2}", realScore: 0.716, realStatus: "RESCUED" },
    { id: "2H-Q19b", source: "1MA1/2H", text: "Is MN parallel to OB?\nGive a reason for your answer.", realScore: 0.716, realStatus: "RESCUED" },
    { id: "2H-Q20", source: "1MA1/2H", text: "The curve C has equation y = 2x² - 12x + 7\nFind the coordinates of the turning point on C.\n\n(3, -11)", realScore: 0.837, realStatus: "SUCCESS" },
    { id: "2H-Q21", source: "1MA1/2H", text: "The graph of y = g(x) is shown on the grid.\nOn the grid, draw the graph of y = g(-x) + 2\n\n[DRAWING]", realScore: 0.820, realStatus: "SUCCESS" },
    { id: "2H-Q22", source: "1MA1/2H", text: "A and B are points on a circle, centre O.\nMAP and NBP are tangents to the circle.\nProve that AP = BP\n\nOBP", realScore: 0.716, realStatus: "RESCUED" },

    // ==================================================================================
    // SET C: Special Cases (OCR & Non-PP)
    // ==================================================================================
    { id: "OCR-10", source: "OCR", text: "100 people were asked whether they had visited France (F) or Spain (S).\n55 had visited France\n60 had visited Spain\n4 had not visited either country.", realScore: 0.000, realStatus: "FAILED" },
    { id: "NPP-12", source: "Non-PP", text: "Put these in order starting with the smallest.\nYou must show your working.", realScore: 0.000, realStatus: "FAILED" },
    { id: "NPP-13", source: "Non-PP", text: "Work out the value of\nGive your answer in the form $k\\sqrt{3}$", realScore: 0.000, realStatus: "FAILED" }
];

const API_BASE = "http://localhost:5001/api/debug";

async function runTest() {
    console.log("🚀 Starting INTEGRATION Test (Calling Real Backend API)...");
    console.log("🌍 API Endpoint:", `${API_BASE}/detect-question`);

    // Group outputs by Source
    const groups: { [key: string]: any[] } = { "1MA1/3H": [], "1MA1/2H": [], "OCR": [], "Non-PP": [] };

    for (const tc of testCases) {
        const hintMatch = tc.id.match(/Q(\d+[a-z]*)/);
        const hintQ = hintMatch ? hintMatch[1].replace(/[^0-9]/g, '') : "1";

        const qNumMatch = tc.id.match(/Q(\d+[a-z]*)/);
        const qNumHint = qNumMatch ? qNumMatch[1] : null;

        try {
            const response = await axios.post(`${API_BASE}/detect-question`, {
                text: tc.text,
                questionNumberHint: qNumHint,
                examPaperHint: tc.source === '1MA1/2H' ? "1MA1/2H June 2024" : null
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
            else if (Math.abs((localScore || 0) - (tc.realScore || 0)) > 0.1) icon = "⚠️";
            else icon = "✅";

            if (tc.realStatus === "RESCUED" && !correctlyIdentified) icon = "❌ (Rescue Needed)";

            if (tc.source === '1MA1/2H') {
                console.log(`\n🔍 DEBUG ${tc.id}: Found=${result.found}, MatchScore=${result.match?.confidence}`);
                if (result.hintMetadata) {
                    console.log("   Audit Trail (Top 3):", JSON.stringify(result.hintMetadata.auditTrail.slice(0, 3), null, 2));
                }
            }

            (groups[tc.source] || groups["Non-PP"]).push({
                id: tc.id,
                text: tc.text.substring(0, 30).replace(/\n/g, ' '),
                local: (localScore || 0).toFixed(3),
                real: (tc.realScore || 0).toFixed(3),
                realStat: tc.realStatus,
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
    console.log("\n==========================================================================================");
    console.log("| ID       | Snippet                        | Local | Real  | Real Status | Verdict      |");
    console.log("|----------|--------------------------------|-------|-------|-------------|--------------|");

    Object.keys(groups).forEach(source => {
        if (groups[source].length === 0) return;
        console.log(`| --- ${source} --- | | | | | |`);
        groups[source].forEach(r => {
            const lNum = parseFloat(r.local);
            const rNum = parseFloat(r.real);

            // Color coding: Green > Real, Yellow == Real, Red < Real
            let color = "\x1b[31m"; // Default Red
            if (lNum > rNum) color = "\x1b[32m";      // Green
            else if (lNum === rNum) color = "\x1b[33m"; // Yellow

            const coloredLocal = `${color}${r.local.padEnd(5)}\x1b[0m`;

            console.log(`| ${r.id.padEnd(8)} | ${r.text.padEnd(30)} | ${coloredLocal} | ${r.real.padEnd(5)} | ${r.realStat.padEnd(11)} | ${r.icon.padEnd(12)} |`);
        });
    });
    console.log("==========================================================================================");

    process.exit(0);
}

runTest().catch(console.error);
