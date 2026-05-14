# Methodology

## Overview

This site uses **Expected Points Added (EPA)** to evaluate FTC team performance. EPA measures how many points a team contributes to their alliance beyond what an average team would contribute. This methodology differs from that of **Statbotics** in multiple ways, but tries to encapsulate the two main aspects of a team that Statbotics's EPA formula does:

1. Score Margin
2. Points Added

## EPA Model

Let's start by defining the strength of an alliance. The strength of an alliance, which can also be interpreted as how many points the alliance is predicted to score, is defined as:

$$
\hat{S}_{red} = \text{EPA}_{1} + {EPA}_{2}
$$

Let's start with score margin. The predicted score margin is defined as:
$$
\hat{S}_{m} = \hat{S}_{red} - \hat{S}_{blue}
$$

The difference between the actual and predicted score margins is calculated as:
$$
{e}_{m} = \left ({S}_{red} - {S}_{blue}\right) - \hat{S}_{m}
$$

We can find the z-score of the margin difference with the formula:
$$
{z}_{m} = \frac{{e}_{m}}{\sqrt{{\sigma_{1}}^2 + \sigma_{2}^2}}
$$
where $$\sigma_{1}$$ is the standard deviation of scores of the red alliance and $$\sigma_{2}$$ is the standard deviation of scores of the blue alliance.

One more thing: How did we compute the standard deviation of scores? Surely it would be difficult to compute the standard deviation of scores for every single match, and try to extract the standard deviation contributed by one team, right? And to my knowledge, that would be correct. Additionally, it's difficult to get an accurate measure of standard deviation for a team that hasn't played many matches yet. Like any good engineer, we decide to approximate.
The distribution of standard deviations of FTC match scores closely follows Taylor's Power Law, which is an emperical ecological rule relating variance to species population density, and is defined as:
$$
V = aM^b
$$
Taylor's Power Law has many applications apart from biology, to sports analytics and defect rates in quality control. If you really think about it, that's what robotics really is: a sport where robots can break. I found the coefficients a and p by running a linear regression on the log of the score of random teams and the log of the standard deviation of their matches. For example, the coefficients I got for DECODE on a random sample of 100 teams are:
$$
a = 2.1482
$$
$$
b = 0.6543
$$

This essentially means that as teams get better, their scores get less variable proportional to their EPA. I hope this kinda makes sense. Like 2026 AiCitizens isn't gonna score 200 points less than usual, but a team that scores 3 points may score 3 points less than usual quite often.

With that out of the way, let's compute the probability of this surprise or less than happening with a normal CDF, denoted as $$\Phi$$ (btw I did look at the distributions of an individual team's scores and they were normal, and gaussian + gaussian = gaussian, so this is allowed):
$$
P({margin} \leq \hat{margin}) = \Phi\left({z}_{m}\right)
$$

To convert this into a bounded value, we'll subtract 0.5 to get a bounded value ranging from $$(-0.5, 0.5)$$.

Moving on to the second target: Points added. Calculating the probability of a score surprise of a certain score or smaller is relatively simple, as it is just defined as:

$$
P(\text{S}_{red} \leq \hat{S}_{red}) = \Phi\left(\frac{{S}_{red} - \hat{S}_{red}}{\sigma_{1}}\right)
$$

We do the same thing for the blue alliance and subtract 0.5 from both to get a bounded value ranging from $$(-0.5, 0.5)$$.

## Connection to Elo

As a **[former competitive chess player](https://www.uschess.org/msa/MbrDtlMain.php?16070663)**, I became very familiar with the Elo rating system, and decided make a model to emulate it. The Elo rating system uses a k-factor, which bounds maximum amount of rating change that can occur within a match. I won't go over it in depth here, but know that it is bounded. If my k-factor is 40 (which it is), and I beat Magnus Carlsen, I'll go up fewer than 40 rating. Conversely, if I lose to an 800 rated player, I will only lose 40 rating at maximum. However, Elo is a zero-sum system, which doesn't line up with robotics competitions, as the mean score increases as the season goes on. That's why this system has a points added bonus.

Another problem is that games differ from year to year, making the k-factor unpredictable and needing adjustment every year. For now, the k-factors are defined as:
$$
\text{k}_{max} = 0.4 * |\mu_{season}|
$$
$$
{k}_{min} = 0.2 * |\mu_{season}|
$$

Like Statbotics's implementation, the k-factor is a kinda linearly interpolated piecewise function that reminds me about the graph for the market for ample reserves.

$$
$$

There are a few flaws with this assumption: for example, it assumes that the mean score is significantly different than 0. In the future, a new heuristic may be implemented that hopefully incorporates standard deviation of matches instead (or some linear combination of both!). I was just lazy and wanted an easy solution, but this will probably be updated in the future as I process more data.

## EPA Update

Using these two equally weighted metrics of score margin and points added, we compute the following:
$$
{k}_{margin} = P(\text{margin} \leq \hat{margin}) - 0.5
$$
$$
{k}_{points} = P(\text{S}_{red} \leq \hat{S}_{red}) - 0.5
$$

Note that the $${k}_{margin}$$ is inverted for the blue alliance.

Each team's EPA is updated after every match using the following update rule:

$$
\text{EPA}_{new} = \text{EPA}_{old} + \alpha \left( {k}_{margin} + {k}_{points} \right)
$$

where $$\alpha$$ is the k-factor of the team.

And that's pretty much it!

## A Few More Details

1. EPA component split
2. Win probability
3. Data Sources

## EPA Component Split

EPA is split into two components:

$$
\text{EPA} = \text{EPA}_{auto} + \text{EPA}_{teleop}
$$

## Win Probability

Given two alliances with predicted scores, the win probability for the red alliance is computed using a normal CDF from the margin, but with an actual score of zero.

$$
{z} = \frac{0 - \hat{S}_{m}}{\sqrt{{\sigma_{1}}^2 + \sigma_{2}^2}}
$$
$$
P(\text{red wins}) = 1 - \Phi\left({z}\right)
$$

The probability that blue wins is $$ 1 - P(\text{red wins}) $$.

## Data Sources

Means and standard deviations are fit and calculated from the last two weeks of the first month of competition. For DECODE, I took samples from the last two weeks of December, but in the long run, it shouldn't make a difference in rating. All data is taken from the FTCScout GraphQL API.

When a team has no recorded EPA before a match (e.g. their first match of the season), the model falls back to the mean team score:

$$
\text{EPA}_{default} = \frac{\bar{S}}{2}
$$

For future seasons, I plan to initialize each team to the mean score because team "legacy" isn't really much of a thing in FTC compared to FRC teams. A team can be great one year and less great the next, but in FRC, where passing on the torch is a more common thing, great teams tend to stay... well... really good.
